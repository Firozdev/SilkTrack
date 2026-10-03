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
import { notifyRoles } from "@/lib/notify";
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

export async function findOrCreateCustomer(tx: Prisma.TransactionClient, c: CustomerInput, actorId: string) {
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
    const customer = await findOrCreateCustomer(tx, input.customer, actor.id);
    const order = await tx.order.create({
      data: {
        customerId: customer.id,
        createdById: actor.id,
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
            trackingEvents: { create: { leg: "SUPPLIER_TO_CHINA", status: "REQUESTED", message: "Request created", createdById: actor.id } },
          })),
        },
      },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    await logChanges(tx, { entityType: "Order", entityId: order.id, userId: actor.id, action: "CREATE" });
    return order;
  });
  return { order, suggestedType: suggested };
}

async function loadOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true, payments: true } });
  if (!order) throw new UserError("Request not found");
  return order;
}

async function setRequestStatus(tx: Prisma.TransactionClient, orderId: string, from: string, to: Prisma.OrderUpdateInput["requestStatus"], actorId: string) {
  await tx.order.update({ where: { id: orderId }, data: { requestStatus: to } });
  await logChanges(tx, { entityType: "Order", entityId: orderId, userId: actorId, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: from, newValue: to as string }] });
}

/** CS hands the request to the China team (price check / estimate). */
export async function sendToChina(actor: Actor, orderId: string) {
  assertCan(actor.role, "request:edit");
  const order = await loadOrder(orderId);
  if (order.requestStatus !== "NEW") throw new UserError("Only new requests can be sent to China");
  await prisma.$transaction((tx) => setRequestStatus(tx, orderId, order.requestStatus, "SENT_TO_CHINA", actor.id));
  await notifyRoles(["PURCHASE"], {
    type: order.type === "BULK" ? "ESTIMATE_REQUESTED" : "NEW_REQUEST",
    title: order.type === "BULK" ? `Estimate requested: ${docNo("order", order.number)}` : `New request: ${docNo("order", order.number)}`,
    body: `${order.lines.length} product(s), ${order.shippingMethod.toLowerCase()} shipping.`,
    orderId,
  });
}

/** Customer accepted the quote. Purchase is released once an advance is recorded. */
export async function markCustomerApproved(actor: Actor, orderId: string) {
  assertCan(actor.role, "quote:edit");
  const order = await loadOrder(orderId);
  if (order.requestStatus !== "QUOTED" && order.requestStatus !== "SAMPLING") throw new UserError("Only quoted requests can be approved");
  const unpriced = order.lines.filter((l) => l.status !== "CANCELLED" && !l.quotedUnitPriceRmb);
  if (unpriced.length) throw new UserError("Every product needs a quoted price before approval");
  await prisma.$transaction(async (tx) => {
    await setRequestStatus(tx, orderId, order.requestStatus, "CUSTOMER_APPROVED", actor.id);
    await setLineStatus(tx, order.lines.map((l) => l.id), "APPROVED", { actorId: actor.id, message: "Customer approved the quote", onlyForward: true });
  });
  if (hasAdvance(order.payments)) {
    await notifyPurchaseReleased(order.id, order.number);
  } else {
    await notifyRoles(["PURCHASE"], {
      type: "APPROVED_FOR_PURCHASE",
      title: `Customer approved: ${docNo("order", order.number)}`,
      body: "In the purchase queue – request the upfront payment from the BD team.",
      orderId,
    });
  }
}

function hasAdvance(payments: { type: string; amountBdt: Prisma.Decimal }[]) {
  return sum(payments.filter((p) => p.type === "ADVANCE").map((p) => p.amountBdt)).gt(0);
}

async function notifyPurchaseReleased(orderId: string, number: number) {
  await notifyRoles(["PURCHASE"], {
    type: "READY_TO_PURCHASE",
    title: `Payment confirmed – ready to purchase: ${docNo("order", number)}`,
    body: "BD confirmed the upfront payment was received.",
    orderId,
  });
}

export async function markRejected(actor: Actor, orderId: string) {
  assertCan(actor.role, "quote:edit");
  const order = await loadOrder(orderId);
  if (!["QUOTED", "SAMPLING", "SENT_TO_CHINA", "NEW"].includes(order.requestStatus)) throw new UserError("This request can't be rejected now");
  await prisma.$transaction(async (tx) => {
    await setRequestStatus(tx, orderId, order.requestStatus, "REJECTED", actor.id);
    await setLineStatus(tx, order.lines.map((l) => l.id), "CANCELLED", { actorId: actor.id, message: "Customer rejected the quote" });
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
    await notifyPurchaseReleased(order.id, order.number);
  }
  return payment;
}

export async function addComment(actor: Actor, orderId: string, body: string) {
  await loadOrder(orderId);
  const comment = await prisma.comment.create({ data: { orderId, authorId: actor.id, body } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true } });
  // Ping the other side of the BD ↔ China conversation.
  await notifyRoles(
    actor.role === "PURCHASE" ? ["CS", "ADMIN"] : ["PURCHASE"],
    { type: "COMMENT", title: `New comment on ${docNo("order", order.number)}`, body: body.slice(0, 140), orderId },
    actor.id,
  );
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
  if (!["NEW", "SENT_TO_CHINA", "SAMPLING", "QUOTED"].includes(order.requestStatus)) throw new UserError("Approved requests can't be edited");
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

/** Requests waiting on the China team, and upfront-payment requests waiting on BD. */
export async function chinaInbox() {
  const [sent, awaitingAdvance] = await Promise.all([
    prisma.order.findMany({
      // Waiting on China: no quotation submitted yet (drafts count as waiting).
      where: { requestStatus: "SENT_TO_CHINA", status: { not: "ON_HOLD" }, estimates: { none: { status: { in: ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"] } } } },
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
