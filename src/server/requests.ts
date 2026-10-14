import "server-only";
import type { OrderType, PaymentMethod, PaymentType, Prisma, ShippingMethod } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, assertCan, can } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { detectPlatform, normalizeUrl } from "@/lib/links";
import { D, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { logChanges } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { notify } from "./notify";
import { generateReceipt, safely } from "./documents";
import { portalRequestEditable } from "@/lib/editability";
import { deriveOrderStatus, setLineStatus, setOrderStatus } from "./status";
import type { Actor } from "./actor";

export type CustomerInput = {
  /** Existing customer picked in the lookup; their saved details are updated from the form. */
  id?: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  district?: string;
  area?: string;
};

export type LineInput = {
  productName: string;
  color?: string;
  size?: string;
  model?: string;
  quantity: number;
  notes?: string;
  links: string[];
};

export type RequestInput = {
  customer: CustomerInput;
  shippingMethod: ShippingMethod;
  /** Omit to use the suggested type. */
  type?: OrderType;
  targetBudgetBdt?: string;
  customerNotes?: string;
  specialInstructions?: string;
  priority?: number;
  lines: LineInput[];
  /** Create even if a link was already requested. */
  allowDuplicates?: boolean;
};

/** BULK when total quantity or target budget reaches the threshold setting. */
export function suggestType(totalQty: number, budgetBdt: string | undefined, threshold: { quantity: number; valueBdt: string }): OrderType {
  if (totalQty >= threshold.quantity) return "BULK";
  if (budgetBdt && D(budgetBdt).gte(D(threshold.valueBdt))) return "BULK";
  return "SINGLE";
}

/** Earlier requests (not cancelled) containing any of these links. */
export async function findDuplicateLinks(urls: string[], excludeOrderId?: string) {
  const normalized = [...new Set(urls.map(normalizeUrl))];
  if (!normalized.length) return [];
  return prisma.productLink.findMany({
    where: {
      normalizedUrl: { in: normalized },
      orderLine: { status: { not: "CANCELLED" }, orderId: excludeOrderId ? { not: excludeOrderId } : undefined },
    },
    select: { url: true, orderLine: { select: { productName: true, order: { select: { id: true, number: true } } } } },
    take: 20,
  });
}

export async function findOrCreateCustomer(tx: Prisma.TransactionClient, c: CustomerInput, actorId: string | null) {
  const { id, ...fields } = c;
  const phone = fields.phone.replace(/[^\d+]/g, "");
  const data = {
    name: fields.name.trim(),
    phone,
    email: fields.email ?? null,
    address: fields.address.trim(),
    district: fields.district ?? null,
    area: fields.area ?? null,
  };
  if (id) {
    const picked = await tx.customer.findUnique({ where: { id } });
    if (!picked) throw new UserError("The selected customer no longer exists");
    const changes = (Object.keys(data) as (keyof typeof data)[])
      .filter((k) => (picked[k] ?? null) !== data[k])
      .map((k) => ({ field: k, oldValue: picked[k] ?? null, newValue: data[k] }));
    if (!changes.length) return picked;
    const updated = await tx.customer.update({ where: { id }, data });
    await logChanges(tx, { entityType: "Customer", entityId: id, userId: actorId, action: "UPDATE", changes });
    return updated;
  }
  const existing = await tx.customer.findFirst({ where: { phone } });
  if (existing) return existing;
  const count = await tx.customer.count();
  return tx.customer.create({
    data: { ...data, code: `C-${String(count + 1).padStart(5, "0")}` },
  });
}

export async function createRequest(actor: Actor, input: RequestInput) {
  assertCan(actor.role, "request:edit");
  return insertRequest(input, { actorId: actor.id, source: "STAFF" });
}

export type PortalRequestInput = Omit<RequestInput, "customer" | "type" | "priority" | "allowDuplicates" | "specialInstructions">;

/**
 * A customer submits a request in the portal. No duplicate-link check (it would
 * reveal other customers' orders); it goes straight to the China team like a staff request.
 */
export async function createPortalRequest(customerId: string, input: PortalRequestInput, placedBy?: PlacedBy) {
  return insertRequest({ ...input, customer: { id: customerId, name: "", phone: "", address: "" }, allowDuplicates: true }, { source: "PORTAL", customerId, accountId: placedBy?.accountId, agentName: placedBy?.agentName });
}

/** The portal login that placed a request: the customer's own, or their agent's (agentName set). */
export type PlacedBy = { accountId: string; agentName?: string };

async function insertRequest(input: RequestInput, by: { actorId: string; source: "STAFF" } | { source: "PORTAL"; customerId: string; accountId?: string; agentName?: string }) {
  const actorId = by.source === "STAFF" ? by.actorId : null;
  if (input.lines.length === 0) throw new UserError("Add at least one product");

  const allLinks = input.lines.flatMap((l) => l.links);
  if (!input.allowDuplicates) {
    const dups = await findDuplicateLinks(allLinks);
    if (dups.length) {
      throw new UserError(
        "These product links were already requested. Tick “Create anyway” to continue.",
        dups.map((d) => ({ href: `/requests/${d.orderLine.order.id}`, label: `${docNo("order", d.orderLine.order.number)} – ${d.orderLine.productName} (${d.url})` })),
      );
    }
  }

  const threshold = await getSetting("bulk_threshold");
  const suggested = suggestType(
    input.lines.reduce((a, l) => a + l.quantity, 0),
    input.targetBudgetBdt,
    threshold,
  );
  const type = input.type ?? suggested;

  const order = await prisma.$transaction(async (tx) => {
    const customerId = by.source === "PORTAL" ? by.customerId : (await findOrCreateCustomer(tx, input.customer, by.actorId)).id;
    const order = await tx.order.create({
      data: {
        customerId,
        source: by.source,
        createdById: actorId,
        placedByAccountId: by.source === "PORTAL" ? (by.accountId ?? null) : null,
        // New = with the China team: requests go to their queue directly, no "send" step.
        requestStatus: "NEW",
        type,
        typeOverridden: type !== suggested,
        shippingMethod: input.shippingMethod,
        targetBudgetBdt: input.targetBudgetBdt,
        customerNotes: input.customerNotes,
        specialInstructions: input.specialInstructions,
        priority: input.priority ?? 0,
        lines: {
          create: input.lines.map((l, i) => ({
            lineNo: i + 1,
            productName: l.productName,
            color: l.color,
            size: l.size,
            model: l.model,
            quantity: l.quantity,
            notes: l.notes,
            links: { create: l.links.map((url) => ({ url, normalizedUrl: normalizeUrl(url), platform: detectPlatform(url) })) },
            trackingEvents: { create: { leg: "SUPPLIER_TO_CHINA", status: "REQUESTED", message: by.source === "PORTAL" ? "Request submitted in the customer portal" : "Request created", createdById: actorId } },
          })),
        },
      },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    await logChanges(tx, { entityType: "Order", entityId: order.id, userId: actorId, action: "CREATE" });
    return order;
  });
  await notifyNewRequest(order, by.source === "STAFF" ? { userId: by.actorId } : { accountId: by.accountId }, by.source === "PORTAL" ? by.agentName : undefined);
  return { order, suggestedType: suggested };
}

/** A new Buy for Me request reached the China team (Admin and the customer are told too). */
async function notifyNewRequest(order: { id: string; number: number; customerId: string; type: OrderType; shippingMethod: string; lines: unknown[] }, cause: { userId?: string; accountId?: string }, agent?: string) {
  await notify("BUY_REQUEST_NEW", { order, customerId: order.customerId }, { bulk: order.type === "BULK", items: order.lines.length, method: order.shippingMethod.toLowerCase(), agent }, cause);
}

async function loadOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true, payments: true } });
  if (!order) throw new UserError("Request not found");
  return order;
}

async function setRequestStatus(tx: Prisma.TransactionClient, orderId: string, from: string, to: Prisma.OrderUpdateInput["requestStatus"], actorId: string | null) {
  await tx.order.update({ where: { id: orderId }, data: { requestStatus: to } });
  await logChanges(tx, { entityType: "Order", entityId: orderId, userId: actorId, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: from, newValue: to as string }] });
}

/** Customer accepted the quote. Purchase is released once an advance is recorded. */
export async function markCustomerApproved(actor: Actor, orderId: string) {
  assertCan(actor.role, "quote:edit");
  await applyCustomerApproval(orderId, actor.id, "Customer approved the quote");
}

/** Shared by CS (actorId) and the customer in the portal (null). */
export async function applyCustomerApproval(orderId: string, actorId: string | null, message: string) {
  const order = await loadOrder(orderId);
  if (order.requestStatus !== "QUOTED" && order.requestStatus !== "SAMPLING") throw new UserError("Only quoted requests can be approved");
  const unpriced = order.lines.filter((l) => l.status !== "CANCELLED" && !l.quotedUnitPriceRmb);
  if (unpriced.length) throw new UserError("Every product needs a quoted price before approval");
  await prisma.$transaction(async (tx) => {
    await setRequestStatus(tx, orderId, order.requestStatus, "CUSTOMER_APPROVED", actorId);
    await setLineStatus(tx, order.lines.map((l) => l.id), "APPROVED", { actorId, message, onlyForward: true });
  });
  if (hasAdvance(order.payments)) {
    await notifyPurchaseReleased(order);
  } else {
    await notify("APPROVED_FOR_PURCHASE", { order }, {}, { userId: actorId });
  }
}

function hasAdvance(payments: { type: string; amountBdt: Prisma.Decimal }[]) {
  return sum(payments.filter((p) => p.type === "ADVANCE").map((p) => p.amountBdt)).gt(0);
}

async function notifyPurchaseReleased(order: { id: string; number: number }) {
  await notify("PURCHASE_RELEASED", { order });
}

export async function markRejected(actor: Actor, orderId: string) {
  assertCan(actor.role, "quote:edit");
  await applyCustomerRejection(orderId, actor.id, "Customer rejected the quote");
}

export async function applyCustomerRejection(orderId: string, actorId: string | null, message: string) {
  const order = await loadOrder(orderId);
  if (!["QUOTED", "SAMPLING", "NEW"].includes(order.requestStatus)) throw new UserError("This request can't be rejected now");
  await prisma.$transaction(async (tx) => {
    await setRequestStatus(tx, orderId, order.requestStatus, "REJECTED", actorId);
    await setLineStatus(tx, order.lines.map((l) => l.id), "CANCELLED", { actorId, message });
  });
}

const PURCHASED_OR_LATER = ["PURCHASED", "AT_CHINA_WAREHOUSE", "IN_SHIPMENT", "IN_TRANSIT", "ARRIVED_BD", "OUT_FOR_DELIVERY", "DELIVERED"];

export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  assertCan(actor.role, "request:edit");
  const order = await loadOrder(orderId);
  const bought = order.lines.some((l) => PURCHASED_OR_LATER.includes(l.status));
  if (bought && actor.role !== "ADMIN") throw new UserError("Items are already purchased – only Admin can cancel this order");
  await prisma.$transaction(async (tx) => {
    if (order.requestStatus !== "CANCELLED") await setRequestStatus(tx, orderId, order.requestStatus, "CANCELLED", actor.id);
    if (order.status === "ON_HOLD") await setOrderStatus(tx, orderId, "ON_HOLD", "CANCELLED", actor.id);
    await setLineStatus(tx, order.lines.map((l) => l.id), "CANCELLED", { actorId: actor.id, message: `Cancelled: ${reason}` });
  });
}

export async function setHold(actor: Actor, orderId: string, hold: boolean) {
  if (!can(actor.role, "request:edit") && !can(actor.role, "purchase:edit")) throw new ForbiddenError("request:edit");
  const order = await loadOrder(orderId);
  await prisma.$transaction(async (tx) => {
    if (hold) {
      if (order.status === "CANCELLED" || order.status === "DELIVERED") throw new UserError("Order is closed");
      await setOrderStatus(tx, orderId, order.status, "ON_HOLD", actor.id);
    } else {
      if (order.status !== "ON_HOLD") return;
      await setOrderStatus(tx, orderId, "ON_HOLD", deriveOrderStatus(order.lines.map((l) => l.status)), actor.id);
    }
  });
}

export type PaymentInput = {
  type: PaymentType;
  amountBdt: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  paidAt?: Date;
  invoiceId?: string;
};

export async function recordPayment(actor: Actor, orderId: string, input: PaymentInput) {
  assertCan(actor.role, "payment:record");
  if (D(input.amountBdt).lte(0)) throw new UserError("Amount must be greater than zero");
  const order = await loadOrder(orderId);
  const hadAdvance = hasAdvance(order.payments);
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { ...input, paidAt: input.paidAt ?? new Date(), orderId, receivedById: actor.id },
    });
    await logChanges(tx, { entityType: "Payment", entityId: p.id, userId: actor.id, action: "CREATE" });
    return p;
  });
  if (input.type === "ADVANCE" && !hadAdvance && order.requestStatus === "CUSTOMER_APPROVED") {
    await notifyPurchaseReleased(order);
  }
  if (input.type !== "REFUND") {
    await safely("receipt", () => generateReceipt(payment.id, actor.id));
    await notify("PAYMENT_CONFIRMED", { order, customerId: order.customerId }, { amount: D(input.amountBdt).toFixed(2), method: input.method.replace(/_/g, " ").toLowerCase(), kind: input.type.toLowerCase() }, { userId: actor.id });
  }
  return payment;
}

export async function addComment(actor: Actor, orderId: string, body: string) {
  await loadOrder(orderId);
  const comment = await prisma.comment.create({ data: { orderId, authorId: actor.id, body } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, number: true } });
  // Ping the other side of the BD ↔ China conversation.
  await notify(actor.role === "PURCHASE" ? "COMMENT_FROM_CHINA" : "COMMENT_FROM_BD", { order }, { text: body.slice(0, 140) }, { userId: actor.id });
  return comment;
}

export type HeaderInput = {
  shippingMethod: ShippingMethod;
  type: OrderType;
  targetBudgetBdt?: string;
  customerNotes?: string;
  specialInstructions?: string;
  priority: number;
};

export async function updateRequestHeader(actor: Actor, orderId: string, input: HeaderInput) {
  assertCan(actor.role, "request:edit");
  const order = await loadOrder(orderId);
  if (!["NEW", "SAMPLING", "QUOTED"].includes(order.requestStatus)) throw new UserError("Approved requests can't be edited");
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { ...input, targetBudgetBdt: input.targetBudgetBdt ?? null, typeOverridden: true } });
    await logChanges(tx, {
      entityType: "Order",
      entityId: orderId,
      userId: actor.id,
      action: "UPDATE",
      changes: [
        { field: "type", oldValue: order.type, newValue: input.type },
        { field: "shippingMethod", oldValue: order.shippingMethod, newValue: input.shippingMethod },
        { field: "targetBudgetBdt", oldValue: order.targetBudgetBdt?.toString() ?? null, newValue: input.targetBudgetBdt ? D(input.targetBudgetBdt).toString() : null },
      ].filter((c) => c.oldValue !== c.newValue),
    });
  });
}

/** Whether purchase is released: approved by customer and upfront payment confirmed by BD. */
export function isReleasedForPurchase(order: { requestStatus: string; payments: { type: string; amountBdt: Prisma.Decimal }[] }) {
  return order.requestStatus === "CUSTOMER_APPROVED" && hasAdvance(order.payments);
}

/** Buy for Me requests still waiting for the China team's quotation. */
export const awaitingQuoteWhere: Prisma.OrderWhereInput = {
  requestStatus: "NEW",
  status: { notIn: ["ON_HOLD", "CANCELLED"] },
  estimates: { none: { status: { in: ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"] } } },
};

/** Requests waiting on the China team, and upfront-payment requests waiting on BD. */
export async function chinaInbox() {
  const [sent, awaitingAdvance] = await Promise.all([
    prisma.order.findMany({
      // Waiting on China: no quotation submitted yet (drafts count as waiting).
      where: { requestStatus: "NEW", status: { not: "ON_HOLD" }, estimates: { none: { status: { in: ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"] } } } },
      orderBy: [{ priority: "desc" }, { requestedAt: "asc" }],
      include: { customer: { select: { code: true } }, lines: { select: { id: true, quotedUnitPriceRmb: true, status: true } }, estimates: { where: { status: "DRAFT" }, select: { id: true } } },
    }),
    prisma.order.findMany({
      where: { requestStatus: "CUSTOMER_APPROVED", status: { notIn: ["CANCELLED", "ON_HOLD"] }, advanceRequestedAt: { not: null }, payments: { none: { type: "ADVANCE" } } },
      orderBy: { advanceRequestedAt: "asc" },
      include: { customer: { select: { code: true, name: true, phone: true } }, advanceRequestedBy: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return { sent, awaitingAdvance };
}

// ───────────────────────── Customer edits in the portal ─────────────────────────

export type PortalLineEdit = LineInput & { id?: string };
export type PortalRequestEdit = Omit<PortalRequestInput, "lines"> & { lines: PortalLineEdit[] };

async function loadForPortalEdit(customerId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId }, include: { lines: { include: { links: true } }, _count: { select: { estimates: true } } } });
  if (!order) throw new UserError("Not found");
  if (!portalRequestEditable({ requestStatus: order.requestStatus, estimateCount: order._count.estimates })) {
    throw new UserError("This request can't be changed any more – message us and we will help");
  }
  return order;
}

/**
 * The customer changes their request before we start quoting: header, lines
 * (add / change / remove) and links. Returns the line id for each input line,
 * in order (to attach new files).
 */
export async function updatePortalRequest(customerId: string, orderId: string, input: PortalRequestEdit) {
  const order = await loadForPortalEdit(customerId, orderId);
  const lines = input.lines.filter((l) => l.productName.trim() && l.quantity > 0);
  if (!lines.length) throw new UserError("Add at least one product");
  const own = new Map(order.lines.map((l) => [l.id, l]));
  if (lines.some((l) => l.id && !own.has(l.id))) throw new UserError("Not found");
  const keep = new Set(lines.map((l) => l.id).filter(Boolean));
  const removed = order.lines.filter((l) => !keep.has(l.id));
  const threshold = await getSetting("bulk_threshold");
  const suggested = suggestType(lines.reduce((a, l) => a + l.quantity, 0), input.targetBudgetBdt, threshold);
  let nextNo = Math.max(0, ...order.lines.map((l) => l.lineNo)) + 1;

  const ids = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { shippingMethod: input.shippingMethod, targetBudgetBdt: input.targetBudgetBdt ?? null, customerNotes: input.customerNotes ?? null, ...(order.typeOverridden ? {} : { type: suggested }) },
    });
    if (removed.length) await tx.orderLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } });
    const ids: string[] = [];
    for (const l of lines) {
      const data = { productName: l.productName.trim(), color: l.color ?? null, size: l.size ?? null, model: l.model ?? null, quantity: l.quantity, notes: l.notes ?? null };
      const links = l.links.map((url) => ({ url, normalizedUrl: normalizeUrl(url), platform: detectPlatform(url) }));
      if (l.id) {
        await tx.orderLine.update({ where: { id: l.id }, data });
        const before = own.get(l.id)!.links.map((x) => x.url).sort().join("\n");
        if (before !== [...l.links].sort().join("\n")) {
          await tx.productLink.deleteMany({ where: { orderLineId: l.id } });
          if (links.length) await tx.productLink.createMany({ data: links.map((x) => ({ ...x, orderLineId: l.id! })) });
        }
        ids.push(l.id);
      } else {
        const created = await tx.orderLine.create({
          data: { orderId, lineNo: nextNo++, ...data, links: { create: links }, trackingEvents: { create: { leg: "SUPPLIER_TO_CHINA", status: "REQUESTED", message: "Added by the customer in the portal" } } },
        });
        ids.push(created.id);
      }
    }
    const summary = [`${lines.length} product(s)`, removed.length ? `${removed.length} removed` : "", lines.some((l) => !l.id) ? `${lines.filter((l) => !l.id).length} added` : ""].filter(Boolean).join(", ");
    await logChanges(tx, { entityType: "Order", entityId: orderId, userId: null, action: "UPDATE", changes: [{ field: "customerEdit", oldValue: null, newValue: summary }] });
    return ids;
  });
  await notify("PORTAL_REQUEST_EDITED", { order });
  return ids;
}

/** The customer cancels their request before we start quoting. */
export async function cancelPortalRequest(customerId: string, orderId: string, reason?: string) {
  const order = await loadForPortalEdit(customerId, orderId);
  const msg = `Cancelled by the customer in the portal${reason ? `: ${reason}` : ""}`;
  await prisma.$transaction(async (tx) => {
    await setRequestStatus(tx, orderId, order.requestStatus, "CANCELLED", null);
    await setLineStatus(tx, order.lines.map((l) => l.id), "CANCELLED", { actorId: null, message: msg });
  });
  await notify("PORTAL_REQUEST_CANCELLED", { order }, { reason });
}
