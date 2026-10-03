import "server-only";
import type { Platform, Prisma, PurchaseStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { allocate, D, money, pctChange, rmbToBdt, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { diffFields, logChanges } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { notifyRoles } from "@/lib/notify";
import { rateForConversion } from "./rates";
import { setLineStatus } from "./status";
import type { Actor } from "./actor";

/** Supplier-order statuses that no longer hold stock for the line. */
const DEAD: PurchaseStatus[] = ["OUT_OF_STOCK", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER"];

/**
 * Customer-approved lines still waiting to be bought. Lines show here as soon
 * as the customer approves; buying is allowed once BD confirms the upfront
 * payment (`advancePaid`).
 */
export async function purchaseQueue() {
  const lines = await prisma.orderLine.findMany({
    where: {
      // PURCHASED lines stay in the queue while part of the quantity is unbought.
      status: { in: ["APPROVED", "PURCHASED"] },
      order: { requestStatus: "CUSTOMER_APPROVED", status: { not: "ON_HOLD" } },
    },
    include: {
      order: {
        select: {
          id: true,
          number: true,
          priority: true,
          requestedAt: true,
          shippingMethod: true,
          advanceRequestedAt: true,
          advanceRequestNote: true,
          customer: { select: { name: true, code: true } },
          payments: { where: { type: "ADVANCE" }, select: { id: true } },
        },
      },
      links: { select: { url: true, platform: true } },
      purchaseLines: { where: { supplierOrder: { status: { notIn: DEAD } } }, select: { quantity: true } },
    },
  });
  return lines
    .map((l) => ({ ...l, advancePaid: l.order.payments.length > 0, remaining: l.quantity - l.purchaseLines.reduce((a, p) => a + p.quantity, 0) }))
    .filter((l) => l.remaining > 0)
    .sort((a, b) => b.order.priority - a.order.priority || a.order.requestedAt.getTime() - b.order.requestedAt.getTime());
}

export type PurchaseInput = {
  supplierName: string;
  platform: Platform;
  supplierOrderNo?: string;
  paymentMethod?: string;
  domesticShippingRmb?: string;
  serviceChargeRmb?: string;
  notes?: string;
  /** Supplier order / tracking page. */
  trackingUrl: string;
  /** Estimated receive date at the China warehouse. */
  expectedArrivalAt: Date;
  lines: { orderLineId: string; quantity: number; unitPriceRmb: string }[];
};

function checkCompletion(trackingUrl: string | undefined, expectedArrivalAt: Date | undefined) {
  if (!trackingUrl?.trim()) throw new UserError("Enter the order tracking URL");
  if (!/^https?:\/\//i.test(trackingUrl.trim())) throw new UserError("Tracking URL must start with http:// or https://");
  if (!expectedArrivalAt) throw new UserError("Enter the estimated receive date at the China warehouse");
}

/**
 * Record a supplier order covering one or more customer lines. Shipping and
 * service charge are split across lines by product value. Lines whose price
 * is above the quote by more than the alert % need BD approval first; the
 * order then stays PENDING.
 */
export async function createPurchase(actor: Actor, input: PurchaseInput) {
  assertCan(actor.role, "purchase:edit");
  if (!input.lines.length) throw new UserError("Select at least one line");
  checkCompletion(input.trackingUrl, input.expectedArrivalAt);
  const orderLines = await prisma.orderLine.findMany({
    where: { id: { in: input.lines.map((l) => l.orderLineId) } },
    include: {
      order: { select: { id: true, number: true, requestStatus: true, payments: { where: { type: "ADVANCE" }, select: { id: true } } } },
      purchaseLines: { where: { supplierOrder: { status: { notIn: DEAD } } }, select: { quantity: true } },
    },
  });
  for (const ol of orderLines) {
    if (!["APPROVED", "PURCHASED"].includes(ol.status) || ol.order.requestStatus !== "CUSTOMER_APPROVED") {
      throw new UserError(`Line “${ol.productName}” is not approved for purchase`);
    }
    if (ol.order.payments.length === 0) {
      throw new UserError(`${docNo("order", ol.order.number)}: upfront payment not confirmed by the BD team yet`);
    }
    const remaining = ol.quantity - ol.purchaseLines.reduce((a, p) => a + p.quantity, 0);
    const want = input.lines.find((l) => l.orderLineId === ol.id)!.quantity;
    if (want > remaining) throw new UserError(`Only ${remaining} of “${ol.productName}” still need to be bought`);
  }
  if (orderLines.length !== input.lines.length) throw new UserError("Some lines were not found");

  const { exchangeRateId, rateUsed } = await rateForConversion();
  const alertPct = D(await getSetting("price_change_alert_pct"));
  const domestic = money(input.domesticShippingRmb ?? 0);
  const service = money(input.serviceChargeRmb ?? 0);

  const productTotals = input.lines.map((l) => money(D(l.unitPriceRmb).mul(l.quantity)));
  const productTotal = sum(productTotals);
  const domShares = allocate(domestic, productTotals);
  const svcShares = allocate(service, productTotals);
  const totalRmb = productTotal.add(domestic).add(service);

  const byId = new Map(orderLines.map((o) => [o.id, o]));
  const lineData = input.lines.map((l, i) => {
    const ol = byId.get(l.orderLineId)!;
    const lineTotal = productTotals[i].add(domShares[i]).add(svcShares[i]);
    const change = ol.quotedUnitPriceRmb ? pctChange(ol.quotedUnitPriceRmb, l.unitPriceRmb) : null;
    const flagged = change !== null && change.gt(alertPct);
    return {
      orderLineId: l.orderLineId,
      quantity: l.quantity,
      unitPriceRmb: l.unitPriceRmb,
      productTotalRmb: productTotals[i],
      domesticShippingShareRmb: domShares[i],
      serviceChargeShareRmb: svcShares[i],
      totalRmb: lineTotal,
      rateUsed,
      totalBdt: rmbToBdt(lineTotal, rateUsed),
      quotedUnitPriceRmb: ol.quotedUnitPriceRmb,
      priceChangePct: change,
      priceApproval: flagged ? ("PENDING" as const) : ("NOT_REQUIRED" as const),
    };
  });
  const needsApproval = lineData.some((l) => l.priceApproval === "PENDING");

  const so = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.upsert({
      where: { name_platform: { name: input.supplierName.trim(), platform: input.platform } },
      update: {},
      create: { name: input.supplierName.trim(), platform: input.platform },
    });
    const so = await tx.supplierOrder.create({
      data: {
        supplierId: supplier.id,
        platform: input.platform,
        supplierOrderNo: input.supplierOrderNo,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        trackingUrl: input.trackingUrl.trim(),
        expectedArrivalAt: input.expectedArrivalAt,
        status: needsApproval ? "PENDING" : "PURCHASED",
        purchasedById: actor.id,
        purchaseDate: new Date(),
        productTotalRmb: productTotal,
        domesticShippingRmb: domestic,
        serviceChargeRmb: service,
        totalRmb,
        exchangeRateId,
        rateUsed,
        totalBdt: rmbToBdt(totalRmb, rateUsed),
        lines: { create: lineData },
      },
    });
    await logChanges(tx, { entityType: "SupplierOrder", entityId: so.id, userId: actor.id, action: "CREATE" });
    if (!needsApproval) {
      await setLineStatus(tx, orderLines.map((o) => o.id), "PURCHASED", { actorId: actor.id, message: `Purchased (${docNo("purchase", so.number)})`, onlyForward: true });
    }
    return so;
  });

  const orders = [...new Set(orderLines.map((o) => o.order.number))].map((n) => docNo("order", n)).join(", ");
  await notifyRoles(["CS", "ADMIN"], needsApproval
    ? { type: "PRICE_APPROVAL_NEEDED", title: `Price change needs approval: ${orders}`, body: `Supplier price is more than ${alertPct}% above the quote (${docNo("purchase", so.number)}).`, orderId: orderLines[0].order.id }
    : { type: "PURCHASE_DONE", title: `Purchased: ${orders}`, body: `${docNo("purchase", so.number)} from ${input.supplierName}.`, orderId: orderLines[0].order.id });
  return so;
}

/** BD (CS/Admin) approves or rejects a flagged price. */
export async function decidePriceChange(actor: Actor, purchaseLineId: string, approve: boolean) {
  assertCan(actor.role, "purchase:approvePriceChange");
  const pl = await prisma.purchaseLine.findUnique({ where: { id: purchaseLineId }, include: { supplierOrder: true, orderLine: { select: { orderId: true } } } });
  if (!pl) throw new UserError("Line not found");
  if (pl.priceApproval !== "PENDING") throw new UserError("This price was already decided");
  const decision = approve ? "APPROVED" : "REJECTED";
  await prisma.$transaction(async (tx) => {
    await tx.purchaseLine.update({ where: { id: pl.id }, data: { priceApproval: decision, priceApprovedById: actor.id, priceApprovedAt: new Date() } });
    await logChanges(tx, { entityType: "PurchaseLine", entityId: pl.id, userId: actor.id, action: "UPDATE", changes: [{ field: "priceApproval", oldValue: "PENDING", newValue: decision }] });
  });
  await notifyRoles(["PURCHASE"], {
    type: "PRICE_APPROVAL_RESULT",
    title: `Price change ${approve ? "approved" : "rejected"}: ${docNo("purchase", pl.supplierOrder.number)}`,
    body: approve ? "You can go ahead and buy." : "Do not buy at this price – mark the purchase as price changed.",
    orderId: pl.orderLine.orderId,
  });
}

async function loadSO(id: string) {
  const so = await prisma.supplierOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) throw new UserError("Purchase not found");
  return so;
}

/** Confirm the purchase after price approval; re-locks today's rate. */
export async function markPurchased(actor: Actor, id: string, completion: { trackingUrl?: string; expectedArrivalAt?: Date } = {}) {
  assertCan(actor.role, "purchase:edit");
  const so = await loadSO(id);
  const trackingUrl = completion.trackingUrl ?? so.trackingUrl ?? undefined;
  const expectedArrivalAt = completion.expectedArrivalAt ?? so.expectedArrivalAt ?? undefined;
  checkCompletion(trackingUrl, expectedArrivalAt);
  if (so.status !== "PENDING") throw new UserError("Only pending purchases can be confirmed");
  if (so.lines.some((l) => l.priceApproval === "PENDING")) throw new UserError("Waiting for BD price approval");
  if (so.lines.some((l) => l.priceApproval === "REJECTED")) throw new UserError("A price was rejected – mark this purchase as Price changed instead");
  const { exchangeRateId, rateUsed } = await rateForConversion();
  await prisma.$transaction(async (tx) => {
    for (const l of so.lines) {
      await tx.purchaseLine.update({ where: { id: l.id }, data: { rateUsed, totalBdt: rmbToBdt(l.totalRmb, rateUsed) } });
    }
    await tx.supplierOrder.update({
      where: { id },
      data: { status: "PURCHASED", purchaseDate: new Date(), exchangeRateId, rateUsed, totalBdt: rmbToBdt(so.totalRmb, rateUsed), trackingUrl: trackingUrl!.trim(), expectedArrivalAt },
    });
    await logChanges(tx, {
      entityType: "SupplierOrder",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: [
        { field: "status", oldValue: so.status, newValue: "PURCHASED" },
        ...(so.rateUsed.equals(rateUsed) ? [] : [{ field: "rateUsed", oldValue: so.rateUsed.toString(), newValue: rateUsed.toString() }]),
      ],
    });
    await setLineStatus(tx, so.lines.map((l) => l.orderLineId), "PURCHASED", { actorId: actor.id, message: `Purchased (${docNo("purchase", so.number)})`, onlyForward: true });
  });
  await notifyRoles(["CS", "ADMIN"], { type: "PURCHASE_DONE", title: `Purchased: ${docNo("purchase", so.number)}`, body: "Price approved and order placed." });
}

export type ShippingInput = { courierName: string; trackingNo: string; trackingUrl?: string; expectedArrivalAt?: Date };

/** Supplier shipped to the China warehouse (leg 1 tracking). */
export async function markShippedBySupplier(actor: Actor, id: string, input: ShippingInput) {
  assertCan(actor.role, "purchase:edit");
  const so = await loadSO(id);
  if (!["PURCHASED", "SHIPPED_BY_SUPPLIER"].includes(so.status)) throw new UserError("Only purchased orders can be marked shipped");
  await prisma.$transaction(async (tx) => {
    await tx.supplierOrder.update({
      where: { id },
      data: {
        status: "SHIPPED_BY_SUPPLIER",
        courierName: input.courierName,
        trackingNo: input.trackingNo.trim(),
        trackingUrl: input.trackingUrl?.trim() || so.trackingUrl,
        expectedArrivalAt: input.expectedArrivalAt ?? so.expectedArrivalAt,
        shippedAt: so.shippedAt ?? new Date(),
      },
    });
    await logChanges(tx, {
      entityType: "SupplierOrder",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: [
        ...(so.status === "SHIPPED_BY_SUPPLIER" ? [] : [{ field: "status", oldValue: so.status, newValue: "SHIPPED_BY_SUPPLIER" }]),
        ...diffFields(so, { expectedArrivalAt: input.expectedArrivalAt ?? so.expectedArrivalAt, trackingNo: input.trackingNo.trim() }, false),
      ],
    });
    for (const l of so.lines) {
      await tx.trackingEvent.create({
        data: { orderLineId: l.orderLineId, leg: "SUPPLIER_TO_CHINA", message: "Shipped by supplier to China warehouse", courier: input.courierName, trackingNo: input.trackingNo.trim(), createdById: actor.id },
      });
    }
  });
}

/** Out of stock / price changed / refund: lines go back to the purchase queue. */
export async function markProblem(actor: Actor, id: string, status: "OUT_OF_STOCK" | "PRICE_CHANGED" | "REFUND_FROM_SUPPLIER", note?: string) {
  assertCan(actor.role, "purchase:edit");
  const so = await loadSO(id);
  if (so.status === "RECEIVED_AT_CHINA_WAREHOUSE") throw new UserError("Already received at the warehouse");
  await prisma.$transaction(async (tx) => {
    await tx.supplierOrder.update({ where: { id }, data: { status, notes: [so.notes, note].filter(Boolean).join("\n") || null } });
    await logChanges(tx, { entityType: "SupplierOrder", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "status", oldValue: so.status, newValue: status }] });
    const back = await tx.orderLine.findMany({ where: { id: { in: so.lines.map((l) => l.orderLineId) }, status: "PURCHASED" }, select: { id: true } });
    await setLineStatus(tx, back.map((l) => l.id), "APPROVED", { actorId: actor.id, message: `${status.replace(/_/g, " ").toLowerCase()} – back to purchase queue`, leg: "SUPPLIER_TO_CHINA" });
  });
  await notifyRoles(["CS", "ADMIN"], { type: "PURCHASE_PROBLEM", title: `${docNo("purchase", so.number)}: ${status.replace(/_/g, " ").toLowerCase()}`, body: note ?? "" });
}

export function listPurchases(where: Prisma.SupplierOrderWhereInput = {}) {
  return prisma.supplierOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: { select: { name: true } }, purchasedBy: { select: { name: true } }, lines: { select: { priceApproval: true, orderLine: { select: { order: { select: { number: true } } } } } } },
  });
}

/**
 * China team asks BD to collect an upfront payment from the customer before
 * buying. BD confirms by recording an ADVANCE payment on the order.
 */
export async function requestUpfrontPayment(actor: Actor, orderId: string, note?: string) {
  assertCan(actor.role, "purchase:edit");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: { where: { type: "ADVANCE" }, select: { id: true } } } });
  if (!order) throw new UserError("Order not found");
  if (order.requestStatus !== "CUSTOMER_APPROVED") throw new UserError("The customer has not approved this order yet");
  if (order.payments.length) throw new UserError("Upfront payment is already confirmed");
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { advanceRequestedAt: new Date(), advanceRequestedById: actor.id, advanceRequestNote: note ?? null } });
    await logChanges(tx, { entityType: "Order", entityId: orderId, userId: actor.id, action: "UPDATE", changes: [{ field: "advanceRequested", oldValue: order.advanceRequestedAt ? "yes" : null, newValue: note ?? "yes" }] });
    await tx.comment.create({ data: { orderId, authorId: actor.id, body: `Upfront payment requested before purchase.${note ? ` ${note}` : ""}` } });
  });
  await notifyRoles(["CS", "ADMIN"], {
    type: "UPFRONT_PAYMENT_REQUESTED",
    title: `Upfront payment requested: ${docNo("order", order.number)}`,
    body: note ?? "Collect the advance from the customer and record it to release the purchase.",
    orderId,
  });
}
