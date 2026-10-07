import "server-only";
import type { EstimateStatus, Prisma, ShippingMethod } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, canSeeSelling } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, money, sum } from "@/lib/money";
import { calcQuotation } from "@/lib/quotation";
import { BD_TZ, today } from "@/lib/dates";
import { docNo } from "@/lib/format";
import { logChanges, diffFields } from "@/lib/audit";
import { notifyRoles, queueCustomerMessage } from "@/lib/notify";
import { rateForConversion } from "./rates";
import { quoteBreakdown } from "./quote-breakdown";
import { applyCustomerApproval, applyCustomerRejection, markCustomerApproved, markRejected } from "./requests";
import { setLineStatus } from "./status";
import type { Actor } from "./actor";

type Tx = Prisma.TransactionClient;

export type QuotationLineInput = {
  orderLineId: string;
  unitPriceRmb: string;
  moq?: number;
  unitWeightKg?: string;
  cartonCount?: number;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  /** Only used when the actor may set selling prices. */
  sellingPriceBdt?: string;
};

export type QuotationInput = {
  shippingMethod: ShippingMethod;
  shippingRatePerKgRmb?: string;
  shippingRatePerCbmRmb?: string;
  domesticShippingRmb?: string;
  packingRmb?: string;
  inspectionRmb?: string;
  serviceFeeRmb?: string;
  validUntil: Date;
  notes?: string;
  lines: QuotationLineInput[];
};

const EDITABLE_BY_CHINA: EstimateStatus[] = ["DRAFT"];

async function loadEstimate(id: string) {
  const e = await prisma.estimate.findUnique({ where: { id }, include: { lines: true, order: { include: { lines: true } } } });
  if (!e) throw new UserError("Quotation not found");
  return e;
}

function assertCanSetSelling(actor: Actor) {
  if (!canSeeSelling(actor)) throw new ForbiddenError("price:viewSelling");
}

/**
 * Selling totals from the lines. Selling prices are PRODUCT prices (shipping
 * is charged separately on the lot's weight / CBM), so the margin compares
 * them with the product cost: products + China costs, without international
 * shipping. grand total = Σ selling, margin = grand total − product cost BDT.
 */
function sellingTotals(lines: { sellingPriceBdt: Prisma.Decimal | string | null | undefined }[], productCostBdt: Prisma.Decimal) {
  if (lines.some((l) => l.sellingPriceBdt === null || l.sellingPriceBdt === undefined || l.sellingPriceBdt === "")) {
    return { grandTotalBdt: null, marginBdt: null };
  }
  const grand = money(sum(lines.map((l) => l.sellingPriceBdt)));
  return { grandTotalBdt: grand, marginBdt: grand.sub(productCostBdt) };
}

/**
 * China creates or updates the draft quotation for a request. The rate in
 * force today is locked on every save.
 */
export async function saveQuotation(actor: Actor, orderId: string, input: QuotationInput) {
  assertCan(actor.role, "estimate:edit");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true, estimates: { orderBy: { version: "desc" }, take: 1, include: { lines: true } } } });
  if (!order) throw new UserError("Request not found");
  if (order.requestStatus !== "SENT_TO_CHINA") throw new UserError("The request must be sent to China before it can be quoted");
  const latest = order.estimates[0];
  if (latest && !EDITABLE_BY_CHINA.includes(latest.status)) throw new UserError(`Quotation v${latest.version} is ${latest.status.toLowerCase().replace(/_/g, " ")} – revise it to make changes`);

  const activeLines = order.lines.filter((l) => l.status !== "CANCELLED");
  const byId = new Map(input.lines.map((l) => [l.orderLineId, l]));
  for (const l of activeLines) if (!byId.has(l.id)) throw new UserError(`Enter a price for “${l.productName}”`);
  if (input.shippingMethod === "AIR" && !input.shippingRatePerKgRmb) throw new UserError("Enter the air shipping rate per kg (RMB)");
  if (input.shippingMethod === "SEA" && !input.shippingRatePerCbmRmb) throw new UserError("Enter the sea shipping rate per CBM (RMB)");
  const allowSelling = canSeeSelling(actor);

  const { exchangeRateId, rateUsed } = await rateForConversion();
  const ordered = activeLines.map((ol) => ({ ol, li: byId.get(ol.id)! }));
  const calc = calcQuotation({ ...input, lines: ordered.map(({ ol, li }) => ({ ...li, quantity: ol.quantity })) }, rateUsed);

  const prevSelling = new Map((latest?.lines ?? []).map((l) => [l.orderLineId, l.sellingPriceBdt]));
  const lineData = ordered.map(({ ol, li }, i) => ({
    orderLineId: ol.id,
    productName: ol.productName,
    quantity: ol.quantity,
    moq: li.moq ?? null,
    unitPriceRmb: li.unitPriceRmb,
    lineTotalRmb: calc.lines[i].lineTotalRmb,
    unitWeightKg: li.unitWeightKg ?? null,
    weightKg: calc.lines[i].weightKg,
    cartonCount: li.cartonCount ?? 0,
    lengthCm: li.lengthCm ?? null,
    widthCm: li.widthCm ?? null,
    heightCm: li.heightCm ?? null,
    cbm: calc.lines[i].cbm,
    sellingPriceBdt: allowSelling && li.sellingPriceBdt ? li.sellingPriceBdt : (prevSelling.get(ol.id) ?? null),
  }));

  const data = {
    shippingMethod: input.shippingMethod,
    shippingRatePerKgRmb: input.shippingRatePerKgRmb ?? null,
    shippingRatePerCbmRmb: input.shippingRatePerCbmRmb ?? null,
    domesticShippingRmb: input.domesticShippingRmb ?? 0,
    packingRmb: input.packingRmb ?? 0,
    inspectionRmb: input.inspectionRmb ?? 0,
    serviceFeeRmb: input.serviceFeeRmb ?? 0,
    grossWeightKg: calc.grossWeightKg,
    cartonCount: calc.cartonCount,
    cbm: calc.cbm,
    shippingRmb: calc.shippingRmb,
    exchangeRateId,
    rateUsed,
    rmbSubtotal: calc.rmbSubtotal,
    totalRmb: calc.totalRmb,
    productCostBdt: calc.productCostBdt,
    shippingBdt: calc.shippingBdt,
    totalBdt: calc.totalBdt,
    ...sellingTotals(lineData, calc.productCostBdt),
    validUntil: input.validUntil,
    notes: input.notes ?? null,
  };

  return prisma.$transaction(async (tx) => {
    if (latest) {
      await tx.estimateLine.deleteMany({ where: { estimateId: latest.id } });
      const e = await tx.estimate.update({ where: { id: latest.id }, data: { ...data, lines: { create: lineData } } });
      await logChanges(tx, {
        entityType: "Estimate",
        entityId: e.id,
        userId: actor.id,
        action: "UPDATE",
        changes: diffFields(latest, { totalRmb: e.totalRmb, rateUsed: e.rateUsed, grossWeightKg: e.grossWeightKg, cbm: e.cbm, shippingRmb: e.shippingRmb, grandTotalBdt: e.grandTotalBdt }),
      });
      return e;
    }
    const e = await tx.estimate.create({ data: { ...data, orderId, version: 1, createdById: actor.id, lines: { create: lineData } } });
    await logChanges(tx, { entityType: "Estimate", entityId: e.id, userId: actor.id, action: "CREATE" });
    return e;
  });
}

async function setStatus(tx: Tx, id: string, from: EstimateStatus, to: EstimateStatus, actorId: string | null, extra: Prisma.EstimateUpdateInput = {}) {
  await tx.estimate.update({ where: { id }, data: { status: to, ...extra } });
  await logChanges(tx, { entityType: "Estimate", entityId: id, userId: actorId, action: "UPDATE", changes: [{ field: "status", oldValue: from, newValue: to }] });
}

/** China hands the quotation to the BD team. */
export async function submitQuotation(actor: Actor, id: string) {
  assertCan(actor.role, "estimate:edit");
  const e = await loadEstimate(id);
  if (e.status !== "DRAFT") throw new UserError("Only drafts can be submitted");
  await prisma.$transaction((tx) => setStatus(tx, id, e.status, "SUBMITTED_BY_CHINA", actor.id, { submittedAt: new Date() }));
  await notifyRoles(["CS", "ADMIN"], {
    type: "ESTIMATE_READY",
    title: `Quotation ready: ${docNo("order", e.order.number)}`,
    body: `${docNo("estimate", e.number)} v${e.version} – total ¥${e.totalRmb.toFixed(2)}. Add selling prices and send to the customer, or request a sample.`,
    orderId: e.orderId,
  });
}

/** Selling price per line (BDT). BD always; China users only with canSetSellingPrice. */
export async function setSellingPrices(actor: Actor, id: string, lines: { lineId: string; sellingPriceBdt: string }[]) {
  assertCanSetSelling(actor);
  const e = await loadEstimate(id);
  if (!["DRAFT", "SUBMITTED_BY_CHINA", "REVIEWED_BY_BD"].includes(e.status)) throw new UserError("Selling prices can't be changed at this stage – revise the quotation");
  const isBd = actor.role !== "PURCHASE";
  await prisma.$transaction(async (tx) => {
    const byId = new Map(e.lines.map((l) => [l.id, l]));
    for (const p of lines) {
      const l = byId.get(p.lineId);
      if (!l) continue;
      const next = money(p.sellingPriceBdt);
      if (l.sellingPriceBdt?.equals(next)) continue;
      await tx.estimateLine.update({ where: { id: l.id }, data: { sellingPriceBdt: next } });
      await logChanges(tx, { entityType: "EstimateLine", entityId: l.id, userId: actor.id, action: "UPDATE", changes: [{ field: "sellingPriceBdt", oldValue: l.sellingPriceBdt?.toString() ?? null, newValue: next.toString() }] });
    }
    const fresh = await tx.estimateLine.findMany({ where: { estimateId: id } });
    const totals = sellingTotals(fresh, e.productCostBdt);
    await tx.estimate.update({ where: { id }, data: totals });
    if (isBd && e.status === "SUBMITTED_BY_CHINA") await setStatus(tx, id, e.status, "REVIEWED_BY_BD", actor.id, { reviewedAt: new Date(), reviewedBy: { connect: { id: actor.id } } });
  });
}

/**
 * CS enters selling prices PER UNIT; they are stored as line totals
 * (unit × the line's quantity, taken from the database).
 */
export async function setUnitSellingPrices(actor: Actor, id: string, lines: { lineId: string; unitPriceBdt: string }[]) {
  const qty = new Map((await prisma.estimateLine.findMany({ where: { estimateId: id }, select: { id: true, quantity: true } })).map((l) => [l.id, l.quantity]));
  if (lines.some((l) => !qty.has(l.lineId))) throw new UserError("Unknown product line");
  return setSellingPrices(
    actor,
    id,
    lines.map((l) => ({ lineId: l.lineId, sellingPriceBdt: money(D(l.unitPriceBdt).mul(qty.get(l.lineId)!)).toString() })),
  );
}

/** BD sends the quotation to the customer: prices copied to the order, request becomes Quoted. */
export async function sendQuotationToCustomer(actor: Actor, id: string) {
  assertCan(actor.role, "quote:edit");
  const e = await loadEstimate(id);
  if (!["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD"].includes(e.status)) throw new UserError("Only submitted quotations can be sent to the customer");
  if (e.lines.some((l) => !l.sellingPriceBdt)) throw new UserError("Enter a selling price for every product first");
  if (e.validUntil < today(BD_TZ)) throw new UserError("This quotation has expired – revise it to re-price at today's rate");
  await prisma.$transaction(async (tx) => {
    for (const l of e.lines) {
      if (!l.orderLineId) continue;
      await tx.orderLine.update({ where: { id: l.orderLineId }, data: { quotedUnitPriceRmb: l.unitPriceRmb, sellingPriceBdt: l.sellingPriceBdt } });
    }
    await setStatus(tx, id, e.status, "SENT_TO_CUSTOMER", actor.id, { sentAt: new Date() });
    if (e.order.requestStatus !== "QUOTED") {
      await tx.order.update({ where: { id: e.orderId }, data: { requestStatus: "QUOTED" } });
      await logChanges(tx, { entityType: "Order", entityId: e.orderId, userId: actor.id, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: e.order.requestStatus, newValue: "QUOTED" }] });
    }
    await setLineStatus(tx, e.lines.map((l) => l.orderLineId).filter((x): x is string => !!x), "QUOTED", { actorId: actor.id, message: `Quotation ${docNo("estimate", e.number)} v${e.version} sent to customer`, onlyForward: true });
  });
  const b = await quoteBreakdown({ ...e, sentAt: new Date() });
  await queueCustomerMessage(e.order.customerId, "WHATSAPP", {
    type: "QUOTE_READY",
    title: "Quotation ready",
    body: `Your quotation for ${docNo("order", e.order.number)} is ready. Products: ৳${b.products.toFixed(2)}${
      b.shipping ? `; estimated shipping ৳${b.shipping.amount.add(b.delivery).toFixed(2)} (can change with your lot's actual weight/CBM); estimated total ৳${b.estimatedTotal.toFixed(2)}` : "; shipping is charged on your lot's actual weight/CBM"
    }. Valid until ${e.validUntil.toISOString().slice(0, 10)}.`,
    orderId: e.orderId,
  });
}

/** Customer accepted: order goes to the China purchase queue. Expired quotations must be re-priced first. */
export async function approveQuotation(actor: Actor, id: string) {
  assertCan(actor.role, "quote:edit");
  const e = await loadEstimate(id);
  if (e.status !== "SENT_TO_CUSTOMER") throw new UserError("Only quotations sent to the customer can be approved");
  if (e.validUntil < today(BD_TZ)) throw new UserError("This quotation has expired – revise it to re-price at today's rate before approval");
  await prisma.$transaction((tx) => setStatus(tx, id, e.status, "APPROVED", actor.id, { decidedAt: new Date() }));
  await markCustomerApproved(actor, e.orderId);
}

export async function rejectQuotation(actor: Actor, id: string) {
  assertCan(actor.role, "quote:edit");
  const e = await loadEstimate(id);
  if (e.status !== "SENT_TO_CUSTOMER") throw new UserError("Only quotations sent to the customer can be rejected");
  await prisma.$transaction((tx) => setStatus(tx, id, e.status, "REJECTED", actor.id, { decidedAt: new Date() }));
  await markRejected(actor, e.orderId);
}

/**
 * The customer approves or declines the quotation sent to them, in the
 * portal. Same effect as CS recording it; only their own requests.
 */
export async function decidePortalQuotation(customerId: string, id: string, decision: "APPROVE" | "DECLINE", reason?: string) {
  const e = await prisma.estimate.findUnique({ where: { id }, include: { order: { select: { id: true, number: true, customerId: true } } } });
  if (!e || e.order.customerId !== customerId) throw new UserError("Quotation not found");
  if (e.status !== "SENT_TO_CUSTOMER") throw new UserError("This quotation was already answered");
  const ref = `${docNo("estimate", e.number)} v${e.version}`;
  if (decision === "APPROVE") {
    if (e.validUntil < today(BD_TZ)) throw new UserError("This quotation has expired. We will send you an updated price.");
    await prisma.$transaction((tx) => setStatus(tx, id, e.status, "APPROVED", null, { decidedAt: new Date(), decidedInPortal: true }));
    await applyCustomerApproval(e.orderId, null, `Customer approved quotation ${ref} in the portal`);
  } else {
    await prisma.$transaction((tx) => setStatus(tx, id, e.status, "REJECTED", null, { decidedAt: new Date(), decidedInPortal: true, notes: reason ? `${e.notes ? `${e.notes}\n` : ""}Declined by customer: ${reason}` : e.notes }));
    await applyCustomerRejection(e.orderId, null, `Customer declined quotation ${ref} in the portal${reason ? `: ${reason}` : ""}`);
  }
  await notifyRoles(["CS", "ADMIN"], {
    type: decision === "APPROVE" ? "PORTAL_QUOTE_APPROVED" : "PORTAL_QUOTE_DECLINED",
    title: `${decision === "APPROVE" ? "Quote approved" : "Quote declined"} by customer: ${docNo("order", e.order.number)}`,
    body: decision === "APPROVE" ? `${ref} – collect the advance payment.` : `${ref}${reason ? ` – ${reason}` : ""}`,
    orderId: e.orderId,
  });
}

/**
 * New version for changes or re-pricing: copies the quotation into a fresh
 * draft (v+1) for China; the old one becomes Revised. The request goes back
 * to "Sent to China".
 */
export async function reviseQuotation(actor: Actor, id: string, reason?: string) {
  if (actor.role === "PURCHASE") assertCan(actor.role, "estimate:edit");
  else assertCan(actor.role, "quote:edit");
  const e = await loadEstimate(id);
  if (!["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"].includes(e.status)) throw new UserError("This quotation can't be revised");
  if (await prisma.estimate.findFirst({ where: { previousVersionId: id } })) throw new UserError("A newer version already exists");
  const next = await prisma.$transaction(async (tx) => {
    await setStatus(tx, id, e.status, "REVISED", actor.id);
    const n = await tx.estimate.create({
      data: {
        orderId: e.orderId,
        version: e.version + 1,
        previousVersionId: e.id,
        status: "DRAFT",
        createdById: actor.id,
        domesticShippingRmb: e.domesticShippingRmb,
        packingRmb: e.packingRmb,
        inspectionRmb: e.inspectionRmb,
        serviceFeeRmb: e.serviceFeeRmb,
        grossWeightKg: e.grossWeightKg,
        cartonCount: e.cartonCount,
        cbm: e.cbm,
        shippingMethod: e.shippingMethod,
        shippingRatePerKgRmb: e.shippingRatePerKgRmb,
        shippingRatePerCbmRmb: e.shippingRatePerCbmRmb,
        shippingRmb: e.shippingRmb,
        exchangeRateId: e.exchangeRateId,
        rateUsed: e.rateUsed,
        rmbSubtotal: e.rmbSubtotal,
        totalRmb: e.totalRmb,
        productCostBdt: e.productCostBdt,
        shippingBdt: e.shippingBdt,
        totalBdt: e.totalBdt,
        marginBdt: e.marginBdt,
        grandTotalBdt: e.grandTotalBdt,
        validUntil: e.validUntil,
        notes: [e.notes, reason && `Revision: ${reason}`].filter(Boolean).join("\n") || null,
        lines: {
          create: e.lines.map((l) => ({
            orderLineId: l.orderLineId,
            productName: l.productName,
            moq: l.moq,
            quantity: l.quantity,
            unitPriceRmb: l.unitPriceRmb,
            lineTotalRmb: l.lineTotalRmb,
            unitWeightKg: l.unitWeightKg,
            weightKg: l.weightKg,
            cartonCount: l.cartonCount,
            lengthCm: l.lengthCm,
            widthCm: l.widthCm,
            heightCm: l.heightCm,
            cbm: l.cbm,
            sellingPriceBdt: l.sellingPriceBdt,
          })),
        },
      },
    });
    if (e.order.requestStatus !== "SENT_TO_CHINA") {
      await tx.order.update({ where: { id: e.orderId }, data: { requestStatus: "SENT_TO_CHINA" } });
      await logChanges(tx, { entityType: "Order", entityId: e.orderId, userId: actor.id, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: e.order.requestStatus, newValue: "SENT_TO_CHINA" }] });
    }
    return n;
  });
  if (actor.role !== "PURCHASE") {
    await notifyRoles(["PURCHASE"], { type: "ESTIMATE_REVISION", title: `Quotation revision requested: ${docNo("order", e.order.number)}`, body: reason ?? `Update ${docNo("estimate", e.number)} (now v${next.version}).`, orderId: e.orderId });
  }
  return next;
}

/** Quotation with order context, for the detail page. */
export function getQuotation(id: string) {
  return prisma.estimate.findUnique({
    where: { id },
    include: {
      lines: { include: { orderLine: { select: { lineNo: true, color: true, size: true, model: true, links: { select: { url: true }, take: 1 } } } }, orderBy: { orderLine: { lineNo: "asc" } } },
      order: { select: { id: true, number: true, type: true, requestStatus: true, shippingMethod: true, customerId: true, customer: { select: { name: true, code: true, phone: true, address: true, district: true } } } },
      createdBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      exchangeRate: { select: { effectiveDate: true } },
      previousVersion: { select: { id: true, version: true } },
      nextVersion: { select: { id: true, version: true } },
    },
  });
}
