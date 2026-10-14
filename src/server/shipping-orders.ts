import "server-only";
import type { DeliveryCourier, PaymentMethod, Prisma, QaResult, ReceivingCondition, ShippingMethod, ShippingOrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, can } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, cbmOf, money, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { diffFields, logChanges } from "@/lib/audit";
import { queueCustomerMessage } from "@/lib/notify";
import { notify, type About } from "./notify";
import { generateReceipt, generateShippingInvoice, safely } from "./documents";
import { portalShippingEditable } from "@/lib/editability";
import { rateForConversion } from "./rates";
import { liveRate, rateCardFor } from "./shipping-rates";
import { capacityWarning, isAccepting, recalcTotals, suggestShipment } from "./shipments";
import { findOrCreateCustomer, type CustomerInput, type PlacedBy } from "./requests";
import type { Actor } from "./actor";

type Tx = Prisma.TransactionClient;

/** Main path; QA_DONE only when the customer asked for QA. Plus CANCELLED / ON_HOLD. */
export const SHIPPING_FLOW: ShippingOrderStatus[] = ["REQUESTED", "RECEIVED_CHINA", "QA_DONE", "IN_SHIPMENT", "RECEIVED_BD", "INVOICED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"];

export const shippingNo = (s: { number: number }) => docNo("shippingOrder", s.number);

async function load(id: string) {
  const s = await prisma.shippingOrder.findUnique({ where: { id }, include: { customer: { select: { id: true, code: true, name: true } }, shipment: true } });
  if (!s) throw new UserError("Shipping order not found");
  return s;
}

/** Status change + audit + timeline entry. */
async function move(tx: Tx, s: { id: string; status: ShippingOrderStatus }, to: ShippingOrderStatus, actorId: string | null, message: string, data: Prisma.ShippingOrderUncheckedUpdateInput = {}) {
  await tx.shippingOrder.update({ where: { id: s.id }, data: { ...data, status: to } });
  await logChanges(tx, { entityType: "ShippingOrder", entityId: s.id, userId: actorId, action: "UPDATE", changes: s.status === to ? [] : [{ field: "status", oldValue: s.status, newValue: to }] });
  await tx.shippingOrderEvent.create({ data: { shippingOrderId: s.id, status: to, message, createdById: actorId } });
}

function requireStatus(s: { status: ShippingOrderStatus }, allowed: ShippingOrderStatus[], message: string) {
  if (s.status === "CANCELLED") throw new UserError("This shipping order is cancelled");
  if (s.status === "ON_HOLD") throw new UserError("This shipping order is on hold – release it first");
  if (!allowed.includes(s.status)) throw new UserError(message);
}

// ───────────────────────── Request ─────────────────────────

export type ShippingItemInput = { productName: string; description?: string; quantity: number; courierName?: string; trackingNo?: string };

export type ShippingOrderInput = {
  customer: CustomerInput;
  shippingMethod: ShippingMethod;
  qaRequested: boolean;
  declaredWeightKg?: string;
  declaredCbm?: string;
  customerNotes?: string;
  items: ShippingItemInput[];
};

/** CS / Admin enters a shipping-only request for a customer who buys in China themselves. */
export async function createShippingOrder(actor: Actor, input: ShippingOrderInput) {
  assertCan(actor.role, "request:edit");
  return insertShippingOrder(input, { actorId: actor.id, source: "STAFF" });
}

export type PortalShippingOrderInput = Omit<ShippingOrderInput, "customer">;

/** The customer submits a shipping order in the portal. */
export async function createPortalShippingOrder(customerId: string, input: PortalShippingOrderInput, placedBy?: PlacedBy) {
  return insertShippingOrder({ ...input, customer: { id: customerId, name: "", phone: "", address: "" } }, { source: "PORTAL", customerId, accountId: placedBy?.accountId, agentName: placedBy?.agentName });
}

async function insertShippingOrder(input: ShippingOrderInput, by: { actorId: string; source: "STAFF" } | { source: "PORTAL"; customerId: string; accountId?: string; agentName?: string }) {
  const actorId = by.source === "STAFF" ? by.actorId : null;
  const items = input.items.filter((i) => i.productName.trim() && i.quantity > 0);
  if (!items.length) throw new UserError("Add at least one product with a quantity");
  const rate = await liveRate();
  const s = await prisma.$transaction(async (tx) => {
    const customerId = by.source === "PORTAL" ? by.customerId : (await findOrCreateCustomer(tx, input.customer, by.actorId)).id;
    const s = await tx.shippingOrder.create({
      data: {
        customerId,
        source: by.source,
        createdById: actorId,
        placedByAccountId: by.source === "PORTAL" ? (by.accountId ?? null) : null,
        shippingMethod: input.shippingMethod,
        qaRequested: input.qaRequested,
        shippingRateId: rate?.id ?? null,
        declaredWeightKg: input.declaredWeightKg,
        declaredCbm: input.declaredCbm,
        customerNotes: input.customerNotes,
        items: {
          create: items.map((i, n) => ({
            lineNo: n + 1,
            productName: i.productName.trim(),
            description: i.description,
            quantity: i.quantity,
            courierName: i.courierName,
            trackingNo: i.trackingNo?.trim() || null,
          })),
        },
        events: { create: { status: "REQUESTED", message: `Shipping-only request${by.source === "PORTAL" ? " from the customer portal" : ""} (${input.shippingMethod.toLowerCase()}${input.qaRequested ? ", QA test requested" : ""})`, createdById: actorId } },
      },
    });
    await logChanges(tx, { entityType: "ShippingOrder", entityId: s.id, userId: actorId, action: "CREATE" });
    return s;
  });
  const cause = by.source === "STAFF" ? { userId: by.actorId } : { accountId: by.accountId };
  await notify("SHIP_REQUEST_NEW", { shipping: s, customerId: s.customerId }, { items: items.length, qa: input.qaRequested, agent: by.source === "PORTAL" ? by.agentName : undefined }, cause);
  if (input.qaRequested) await notify("QA_REQUESTED", { shipping: s }, {}, cause);
  return s;
}

/** Customer / supplier tracking numbers usually arrive later; editable until the goods are received. */
export async function updateShippingTracking(actor: Actor, id: string, items: { itemId: string; courierName?: string; trackingNo?: string }[]) {
  if (!can(actor.role, "request:edit")) assertCan(actor.role, "receiving:edit");
  await applyTracking(id, items, actor.id);
}

/** The customer adds / corrects supplier tracking in the portal (own orders only). */
export async function updatePortalShippingTracking(customerId: string, id: string, items: { itemId: string; courierName?: string; trackingNo?: string }[]) {
  const owner = await prisma.shippingOrder.findUnique({ where: { id }, select: { customerId: true } });
  if (!owner || owner.customerId !== customerId) throw new UserError("Shipping order not found");
  await applyTracking(id, items, null);
}

async function applyTracking(id: string, items: { itemId: string; courierName?: string; trackingNo?: string }[], actorId: string | null) {
  const s = await load(id);
  requireStatus(s, ["REQUESTED"], "Tracking can only be changed before the goods are received");
  const own = new Set((await prisma.shippingOrderItem.findMany({ where: { shippingOrderId: id }, select: { id: true } })).map((i) => i.id));
  if (items.some((i) => !own.has(i.itemId))) throw new UserError("Unknown item");
  await prisma.$transaction(async (tx) => {
    for (const i of items) await tx.shippingOrderItem.update({ where: { id: i.itemId }, data: { courierName: i.courierName ?? null, trackingNo: i.trackingNo?.trim() || null } });
    await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: actorId ? "Supplier tracking updated" : "Supplier tracking updated by the customer", createdById: actorId } });
  });
}

/** Open shipping orders whose expected parcel tracking matches (China receiving search). */
export function findShippingByTracking(trackingNo: string) {
  const q = trackingNo.trim();
  if (!q) return Promise.resolve([]);
  return prisma.shippingOrder.findMany({
    where: { status: { in: ["REQUESTED", "RECEIVED_CHINA", "QA_DONE"] }, items: { some: { trackingNo: { contains: q, mode: "insensitive" } } } },
    take: 10,
    include: { customer: { select: { code: true, name: true } }, items: { orderBy: { lineNo: "asc" } } },
  });
}

// ───────────────────────── China warehouse ─────────────────────────

export type ShippingCartonInput = { lengthCm: string; widthCm: string; heightCm: string; grossWeightKg?: string };

export type ShippingReceiveInput = {
  items: { itemId: string; quantityReceived: number; condition: ReceivingCondition }[];
  cartons: ShippingCartonInput[];
  /** Required unless every carton has its weight. */
  grossWeightKg?: string;
  cartonMark?: string;
};

/**
 * China records the goods at the warehouse: what arrived per item, the cartons
 * (CBM auto) and the gross weight. Can be corrected until it is in a shipment.
 */
export async function receiveShippingChina(actor: Actor, id: string, input: ShippingReceiveInput) {
  assertCan(actor.role, "receiving:edit");
  const s = await prisma.shippingOrder.findUnique({ where: { id }, include: { items: true, customer: { select: { code: true } } } });
  if (!s) throw new UserError("Shipping order not found");
  requireStatus(s, ["REQUESTED", "RECEIVED_CHINA", "QA_DONE"], "Already in a shipment – the warehouse figures can't be changed now");
  if (!input.cartons.length) throw new UserError("Add at least one carton with its dimensions");
  const byId = new Map(s.items.map((i) => [i.id, i]));
  if (input.items.some((i) => !byId.has(i.itemId))) throw new UserError("Unknown item");
  if (!input.items.some((i) => i.quantityReceived > 0)) throw new UserError("Enter the quantity received");

  const cartons = input.cartons.map((c) => ({ ...c, cbm: cbmOf(c.lengthCm, c.widthCm, c.heightCm) }));
  const cartonKg = cartons.every((c) => c.grossWeightKg) ? sum(cartons.map((c) => c.grossWeightKg)) : null;
  const grossWeightKg = input.grossWeightKg ? D(input.grossWeightKg) : cartonKg;
  if (!grossWeightKg || grossWeightKg.lte(0)) throw new UserError("Gross weight is required");
  const cbm = sum(cartons.map((c) => c.cbm));
  const problems = input.items.filter((i) => i.condition !== "OK" || i.quantityReceived < byId.get(i.itemId)!.quantity);
  const first = s.status === "REQUESTED";

  await prisma.$transaction(async (tx) => {
    for (const i of input.items) await tx.shippingOrderItem.update({ where: { id: i.itemId }, data: { quantityReceived: i.quantityReceived, condition: i.condition } });
    await tx.shippingOrderCarton.deleteMany({ where: { shippingOrderId: id } });
    await tx.shippingOrderCarton.createMany({ data: cartons.map((c) => ({ shippingOrderId: id, lengthCm: c.lengthCm, widthCm: c.widthCm, heightCm: c.heightCm, cbm: c.cbm, grossWeightKg: c.grossWeightKg ?? null })) });
    await logChanges(tx, { entityType: "ShippingOrder", entityId: id, userId: actor.id, action: "UPDATE", changes: diffFields(s, { grossWeightKg, cbm }) });
    const data = { cartonCount: cartons.length, cartonMark: input.cartonMark ?? s.customer.code, grossWeightKg, cbm, receivedChinaAt: s.receivedChinaAt ?? new Date(), receivedChinaById: s.receivedChinaById ?? actor.id };
    const msg = `${first ? "Received at China warehouse" : "Warehouse figures corrected"}: ${cartons.length} carton(s), ${grossWeightKg.toString()} kg, ${cbm.toString()} m³${problems.length ? ` – ${problems.length} item(s) with a problem` : ""}`;
    await move(tx, s, first ? "RECEIVED_CHINA" : s.status, actor.id, msg, data);
  });
  const about = { shipping: s, customerId: s.customerId };
  if (first) await notify("RECEIVED_CHINA", about, { detail: `${grossWeightKg.toString()} kg · ${cbm.toString()} m³${s.qaRequested ? " – QA test next" : ""}` }, { userId: actor.id });
  if (problems.length) {
    const problem = problems.map((p) => `${byId.get(p.itemId)!.productName}: ${p.quantityReceived}/${byId.get(p.itemId)!.quantity} ${p.condition.toLowerCase().replace(/_/g, " ")}`).join("; ");
    await notify("ISSUE_REPORTED", about, { problem, where: "China warehouse" }, { userId: actor.id });
  }
}

/** China records the optional QA test. A failed test is flagged to BD, who decide to ship anyway or hold. */
export async function recordQa(actor: Actor, id: string, input: { result: QaResult; notes?: string }) {
  assertCan(actor.role, "receiving:edit");
  const s = await load(id);
  if (!s.qaRequested) throw new UserError("The customer did not ask for a QA test");
  requireStatus(s, ["RECEIVED_CHINA", "QA_DONE"], "Receive the goods at the warehouse before the QA test");
  await prisma.$transaction(async (tx) => {
    await logChanges(tx, { entityType: "ShippingOrder", entityId: id, userId: actor.id, action: "UPDATE", changes: s.qaResult && s.qaResult !== input.result ? [{ field: "qaResult", oldValue: s.qaResult, newValue: input.result }] : [] });
    await move(tx, s, "QA_DONE", actor.id, `QA test ${input.result === "PASSED" ? "passed" : "FAILED"}${input.notes ? `: ${input.notes}` : ""}`, { qaResult: input.result, qaNotes: input.notes ?? null, qaById: actor.id, qaAt: new Date() });
  });
  await notify(input.result === "PASSED" ? "QA_PASSED" : "QA_FAILED", { shipping: s, customerId: s.customerId }, { notes: input.notes }, { userId: actor.id });
}

/**
 * Put the order in a weekly shipment of its method ("auto" = the suggested
 * open one), or move it to another before the shipment closes.
 */
export async function assignShippingOrder(actor: Actor, id: string, shipmentId: string | "auto", now = new Date()) {
  assertCan(actor.role, "shipment:edit");
  const s = await load(id);
  requireStatus(s, ["RECEIVED_CHINA", "QA_DONE", "IN_SHIPMENT"], "Receive the goods at the China warehouse first");
  if (s.qaRequested && !s.qaResult) throw new UserError("Record the QA test before shipping");
  if (s.shipment && !isAccepting(s.shipment, now)) throw new UserError(`${s.shipment.code} is already ${s.shipment.status.toLowerCase()} – the order can't be moved`);
  const sh = await prisma.$transaction(async (tx) => {
    const target = shipmentId === "auto" ? await suggestShipment(tx, s.shippingMethod, now) : await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!target) throw new UserError("Shipment not found");
    if (target.method !== s.shippingMethod) throw new UserError(`${target.code} is a ${target.method.toLowerCase()} shipment; this order ships by ${s.shippingMethod.toLowerCase()}`);
    if (!isAccepting(target, now)) throw new UserError(`${target.code} is not accepting items`);
    if (target.id === s.shipmentId) return target;
    if (target.status === "UPCOMING") await tx.shipment.update({ where: { id: target.id }, data: { status: "OPEN" } });
    await logChanges(tx, { entityType: "ShippingOrder", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "shipment", oldValue: s.shipment?.code ?? null, newValue: target.code }] });
    await move(tx, s, "IN_SHIPMENT", actor.id, `${s.shipment ? "Moved" : "Added"} to shipment ${target.code}`, { shipmentId: target.id });
    await recalcTotals(tx, target.id);
    if (s.shipmentId) await recalcTotals(tx, s.shipmentId);
    return tx.shipment.findUniqueOrThrow({ where: { id: target.id } });
  });
  if (sh.id !== s.shipmentId) await notify("ASSIGNED_TO_SHIPMENT", { shipping: s, shipment: sh, customerId: s.customerId }, { shipment: sh.code }, { userId: actor.id });
  return { shipment: sh, warning: capacityWarning(sh) };
}

// ───────────────────────── Bangladesh ─────────────────────────

export async function receiveShippingBd(actor: Actor, id: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["IN_SHIPMENT"], "The order is not in a shipment yet");
  await prisma.$transaction((tx) => move(tx, s, "RECEIVED_BD", actor.id, `Received in Bangladesh${s.shipment ? ` (${s.shipment.code})` : ""}`, { receivedBdAt: new Date() }));
  await queueCustomerMessage(s.customerId, "WHATSAPP", { type: "SHIPPING_ARRIVED", title: "Arrived in Bangladesh", body: `Your shipment ${shippingNo(s)} has arrived in Bangladesh. We will send the bill shortly.` });
  await notify("ARRIVED_BD", { shipping: s, customerId: s.customerId }, {}, { userId: actor.id });
}

/**
 * Invoice prefill: the rate card locked on the order when it was placed (what
 * the customer was shown), else the live one; blank rates fall back to the
 * rate on the last invoice of that method.
 */
export async function defaultShippingRates(shippingRateId?: string | null) {
  const card = await rateCardFor(shippingRateId);
  const last = (method: ShippingMethod) =>
    prisma.shippingOrder.findFirst({ where: { shippingMethod: method, invoicedAt: { not: null } }, orderBy: { invoicedAt: "desc" }, select: { shipRatePerKgBdt: true, shipRatePerCbmBdt: true } });
  const [lastAir, lastSea] = await Promise.all([card.airPerKgBdt ? null : last("AIR"), card.seaPerCbmBdt ? null : last("SEA")]);
  return {
    perKgBdt: card.airPerKgBdt || lastAir?.shipRatePerKgBdt?.toString() || "",
    perCbmBdt: card.seaPerCbmBdt || lastSea?.shipRatePerCbmBdt?.toString() || "",
    qaFeeBdt: card.qaFeeBdt,
    localDeliveryBdt: card.localDeliveryBdt,
  };
}

export type ShippingInvoiceInput = {
  /** Air: BDT per kg; sea: BDT per CBM. */
  ratePerUnitBdt: string;
  /** Defaults to the China warehouse gross weight / CBM. */
  billWeightKg?: string;
  billCbm?: string;
  qaFeeBdt?: string;
  localDeliveryBdt?: string;
  otherChargeBdt?: string;
  discountBdt?: string;
  /** Printed on the PDF; defaults to 7 days after the invoice date. */
  dueDate?: Date;
  /** Printed on the PDF. */
  notes?: string;
};

export const INVOICE_DUE_DAYS = 7;
export const defaultInvoiceDueDate = (from = new Date()) => new Date(from.getTime() + INVOICE_DUE_DAYS * 86_400_000);

/** Invoice amounts. Air bills on weight, sea on CBM. */
export function shippingCharges(method: ShippingMethod, input: ShippingInvoiceInput & { billWeightKg: string; billCbm: string }) {
  const shippingChargeBdt = money(D(method === "AIR" ? input.billWeightKg : input.billCbm).mul(D(input.ratePerUnitBdt)));
  const invoiceTotalBdt = money(sum([shippingChargeBdt, input.qaFeeBdt, input.localDeliveryBdt, input.otherChargeBdt]).sub(D(input.discountBdt)));
  return { shippingChargeBdt, invoiceTotalBdt };
}

async function paidFor(shippingOrderId: string, db: Pick<typeof prisma, "payment"> | Tx = prisma) {
  const rows = await db.payment.findMany({ where: { shippingOrderId }, select: { type: true, amountBdt: true } });
  return sum(rows.map((r) => (r.type === "REFUND" ? D(r.amountBdt).neg() : r.amountBdt)));
}

/** Balance due for pages. */
export async function shippingBalance(s: { id: string; invoiceTotalBdt: Prisma.Decimal | null }) {
  const paid = await paidFor(s.id);
  const bal = D(s.invoiceTotalBdt).sub(paid);
  return { total: D(s.invoiceTotalBdt), paid, balance: bal.isNeg() ? D(0) : bal };
}

/** BD prepares the customer invoice in BDT after receiving. Can be redone until fully paid. */
export async function invoiceShipping(actor: Actor, id: string, input: ShippingInvoiceInput) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["RECEIVED_BD", "INVOICED"], "Invoice after the goods are received in Bangladesh");
  const billWeightKg = input.billWeightKg ?? s.grossWeightKg?.toString();
  const billCbm = input.billCbm ?? s.cbm?.toString();
  if (s.shippingMethod === "AIR" && !D(billWeightKg).gt(0)) throw new UserError("Enter the weight to bill");
  if (s.shippingMethod === "SEA" && !D(billCbm).gt(0)) throw new UserError("Enter the CBM to bill");
  if (!D(input.ratePerUnitBdt).gt(0)) throw new UserError(`Enter the shipping rate per ${s.shippingMethod === "AIR" ? "kg" : "CBM"}`);
  const { shippingChargeBdt, invoiceTotalBdt } = shippingCharges(s.shippingMethod, { ...input, billWeightKg: billWeightKg ?? "0", billCbm: billCbm ?? "0" });
  if (invoiceTotalBdt.lte(0)) throw new UserError("The invoice total must be more than zero");
  const paid = await paidFor(id);
  if (paid.gt(invoiceTotalBdt)) throw new UserError(`The customer has already paid ${paid.toFixed(2)} – the invoice can't be less than that`);
  const { exchangeRateId, rateUsed } = await rateForConversion();
  const perKg = s.shippingMethod === "AIR" ? D(input.ratePerUnitBdt) : null;
  const perCbm = s.shippingMethod === "SEA" ? D(input.ratePerUnitBdt) : null;
  const to: ShippingOrderStatus = paid.gte(invoiceTotalBdt) ? "READY_FOR_DELIVERY" : "INVOICED";
  await prisma.$transaction(async (tx) => {
    await logChanges(tx, {
      entityType: "ShippingOrder",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: diffFields(s, { billWeightKg: billWeightKg ? D(billWeightKg) : null, billCbm: billCbm ? D(billCbm) : null, shipRatePerKgBdt: perKg, shipRatePerCbmBdt: perCbm, invoiceTotalBdt, rateUsed }),
    });
    await move(tx, s, to, actor.id, `${s.invoicedAt ? "Invoice revised" : "Invoiced"}: ৳${invoiceTotalBdt.toFixed(2)} (shipping ৳${shippingChargeBdt.toFixed(2)})`, {
      billWeightKg: billWeightKg ?? null,
      billCbm: billCbm ?? null,
      shipRatePerKgBdt: perKg,
      shipRatePerCbmBdt: perCbm,
      shippingChargeBdt,
      qaFeeBdt: input.qaFeeBdt ?? null,
      localDeliveryBdt: input.localDeliveryBdt ?? null,
      otherChargeBdt: input.otherChargeBdt ?? null,
      discountBdt: input.discountBdt ?? null,
      invoiceTotalBdt,
      exchangeRateId,
      rateUsed,
      invoicedById: actor.id,
      invoicedAt: new Date(),
      invoiceDueDate: input.dueDate ?? defaultInvoiceDueDate(),
      invoiceNotes: input.notes?.trim() || null,
    });
  });
  await safely("shipping invoice", () => generateShippingInvoice(id, actor.id));
  const about = { shipping: s, customerId: s.customerId };
  await notify("INVOICE_READY", about, { total: invoiceTotalBdt.toFixed(2) }, { userId: actor.id });
  if (to === "READY_FOR_DELIVERY" && s.status !== "READY_FOR_DELIVERY") await notify("READY_FOR_DELIVERY", about, {}, { userId: actor.id });
}

export async function recordShippingPayment(actor: Actor, id: string, input: { amountBdt: string; method: PaymentMethod; reference?: string }) {
  assertCan(actor.role, "payment:record");
  const s = await load(id);
  requireStatus(s, ["INVOICED"], s.invoiceTotalBdt ? "Nothing is due on this order" : "Invoice the order first");
  const amount = D(input.amountBdt);
  if (amount.lte(0)) throw new UserError("Amount must be greater than zero");
  const { balance } = await shippingBalance(s);
  if (amount.gt(balance)) throw new UserError(`That is more than the balance due (৳${balance.toFixed(2)})`);
  const settled = amount.eq(balance);
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { shippingOrderId: id, type: "SHIPPING_SERVICE", amountBdt: amount, method: input.method, reference: input.reference, receivedById: actor.id, paidAt: new Date() },
    });
    await logChanges(tx, { entityType: "Payment", entityId: p.id, userId: actor.id, action: "CREATE" });
    const msg = `${settled ? "Payment received" : "Partial payment"} ৳${amount.toFixed(2)} (${input.method.toLowerCase().replace(/_/g, " ")})`;
    if (settled) await move(tx, s, "READY_FOR_DELIVERY", actor.id, `${msg} – fully paid, ready for delivery`);
    else await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: msg, createdById: actor.id } });
    return p;
  });
  await safely("receipt", () => generateReceipt(payment.id, actor.id));
  await safely("shipping invoice", () => generateShippingInvoice(id, actor.id)); // amount paid / balance changed
  const about = { shipping: s, customerId: s.customerId };
  await notify("PAYMENT_CONFIRMED", about, { amount: amount.toFixed(2), method: input.method.replace(/_/g, " ").toLowerCase(), kind: "shipping" }, { userId: actor.id });
  if (settled) await notify("READY_FOR_DELIVERY", about, {}, { userId: actor.id });
  return payment;
}

export async function dispatchShipping(actor: Actor, id: string, input: { courier: DeliveryCourier; trackingNo?: string }) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["READY_FOR_DELIVERY"], "The order must be fully paid before delivery");
  const how = [input.courier.replace(/_/g, " ").toLowerCase(), input.trackingNo].filter(Boolean).join(" · ");
  await prisma.$transaction((tx) =>
    move(tx, s, "OUT_FOR_DELIVERY", actor.id, `Out for delivery: ${how}`, { deliveryCourier: input.courier, deliveryTrackingNo: input.trackingNo ?? null, dispatchedAt: new Date() }),
  );
  await queueCustomerMessage(s.customerId, "WHATSAPP", { type: "OUT_FOR_DELIVERY", title: "Out for delivery", body: `Your shipment ${shippingNo(s)} is out for delivery (${how}).` });
  await notify("OUT_FOR_DELIVERY", { shipping: s, customerId: s.customerId }, { how }, { userId: actor.id });
}

export async function deliverShipping(actor: Actor, id: string, receiverName?: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["OUT_FOR_DELIVERY"], "Dispatch the order first");
  await prisma.$transaction((tx) => move(tx, s, "DELIVERED", actor.id, `Delivered${receiverName ? ` – received by ${receiverName}` : ""}`, { deliveredAt: new Date(), receiverName: receiverName ?? null }));
  await notify("DELIVERED", { shipping: s, customerId: s.customerId }, {}, { userId: actor.id });
}

/**
 * The customer confirms in the portal that they received the goods. While out
 * for delivery this completes the delivery; afterwards it only adds the note.
 */
export async function confirmShippingReceipt(customerId: string, id: string, input: { note?: string; problem: boolean }) {
  const s = await load(id);
  if (s.customerId !== customerId) throw new UserError("Shipping order not found");
  if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(s.status)) throw new UserError("You can confirm once the order is out for delivery");
  const data = receiptData(s, input);
  const msg = `Customer confirmed receipt${input.problem ? " – PROBLEM reported" : ""}${input.note ? `: ${input.note}` : ""}`;
  await prisma.$transaction(async (tx) => {
    if (s.status === "OUT_FOR_DELIVERY") await move(tx, s, "DELIVERED", null, msg, { ...data, deliveredAt: new Date(), receiverName: s.receiverName ?? "Customer (portal)" });
    else {
      await tx.shippingOrder.update({ where: { id }, data });
      await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: s.customerConfirmedAt ? `Customer added a note${input.problem ? " – PROBLEM reported" : ""}: ${input.note ?? ""}` : msg } });
    }
  });
  await notifyReceipt({ shipping: s }, input);
}

/** Fields to save for a receipt confirmation; later notes are appended with the date. */
export function receiptData(prev: { customerConfirmedAt: Date | null; customerNote: string | null; customerReportedProblem: boolean }, input: { note?: string; problem: boolean }, now = new Date()) {
  const note = input.note?.trim();
  return {
    customerConfirmedAt: prev.customerConfirmedAt ?? now,
    customerNote: !note ? prev.customerNote : prev.customerNote ? `${prev.customerNote}\n[${now.toISOString().slice(0, 10)}] ${note}` : note,
    customerReportedProblem: prev.customerReportedProblem || input.problem,
  };
}

export async function notifyReceipt(about: About, input: { note?: string; problem: boolean }) {
  await notify(input.problem ? "CUSTOMER_PROBLEM_REPORTED" : "CUSTOMER_CONFIRMED_RECEIPT", about, { note: input.note });
}

// ───────────────────────── Customer edits in the portal ─────────────────────────

export type PortalShippingEdit = Omit<ShippingOrderInput, "customer" | "items"> & { items: (ShippingItemInput & { id?: string })[] };

async function loadForPortalEdit(customerId: string, id: string) {
  const s = await prisma.shippingOrder.findFirst({ where: { id, customerId }, include: { items: true } });
  if (!s) throw new UserError("Shipping order not found");
  if (!portalShippingEditable(s)) throw new UserError("This shipping order can't be changed any more – message us and we will help");
  return s;
}

/**
 * The customer changes their shipping order before the goods reach our China
 * warehouse. Returns the item id for each kept input row, in order.
 */
export async function updatePortalShippingOrder(customerId: string, id: string, input: PortalShippingEdit) {
  const s = await loadForPortalEdit(customerId, id);
  const items = input.items.filter((i) => i.productName.trim() && i.quantity > 0);
  if (!items.length) throw new UserError("Add at least one product with a quantity");
  const own = new Set(s.items.map((i) => i.id));
  if (items.some((i) => i.id && !own.has(i.id))) throw new UserError("Unknown item");
  const keep = new Set(items.map((i) => i.id).filter(Boolean));
  const removed = s.items.filter((i) => !keep.has(i.id));
  const ids = await prisma.$transaction(async (tx) => {
    await tx.shippingOrder.update({
      where: { id },
      data: { shippingMethod: input.shippingMethod, qaRequested: input.qaRequested, declaredWeightKg: input.declaredWeightKg ?? null, declaredCbm: input.declaredCbm ?? null, customerNotes: input.customerNotes ?? null },
    });
    if (removed.length) await tx.shippingOrderItem.deleteMany({ where: { id: { in: removed.map((i) => i.id) } } });
    // Renumber 1..n in the customer's order (temporarily offset to avoid unique clashes).
    await tx.shippingOrderItem.updateMany({ where: { shippingOrderId: id }, data: { lineNo: { increment: 10_000 } } });
    const ids: string[] = [];
    for (const [n, i] of items.entries()) {
      const data = { lineNo: n + 1, productName: i.productName.trim(), description: i.description ?? null, quantity: i.quantity, courierName: i.courierName ?? null, trackingNo: i.trackingNo?.trim() || null };
      const row = i.id ? await tx.shippingOrderItem.update({ where: { id: i.id }, data }) : await tx.shippingOrderItem.create({ data: { ...data, shippingOrderId: id } });
      ids.push(row.id);
    }
    await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: `Changed by the customer in the portal (${items.length} product(s)${removed.length ? `, ${removed.length} removed` : ""})` } });
    await logChanges(tx, { entityType: "ShippingOrder", entityId: id, userId: null, action: "UPDATE", changes: [{ field: "customerEdit", oldValue: null, newValue: `${items.length} item(s)` }] });
    return ids;
  });
  await notify("PORTAL_SHIPPING_EDITED", { shipping: s });
  return ids;
}

export async function cancelPortalShippingOrder(customerId: string, id: string, reason?: string) {
  const s = await loadForPortalEdit(customerId, id);
  await prisma.$transaction((tx) => move(tx, s, "CANCELLED", null, `Cancelled by the customer in the portal${reason ? `: ${reason}` : ""}`));
  await notify("PORTAL_SHIPPING_CANCELLED", { shipping: s }, { reason });
}

// ───────────────────────── Hold / cancel ─────────────────────────

/** Hold stops the flow at any step; release returns to the status before the hold. */
export async function setShippingHold(actor: Actor, id: string, hold: boolean, reason?: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  if (["DELIVERED", "CANCELLED"].includes(s.status)) throw new UserError("This shipping order is closed");
  if (hold === (s.status === "ON_HOLD")) return;
  if (hold) {
    await prisma.$transaction((tx) => move(tx, s, "ON_HOLD", actor.id, `On hold${reason ? `: ${reason}` : ""}`));
    return;
  }
  const before = await prisma.shippingOrderEvent.findFirst({ where: { shippingOrderId: id, status: { not: null, notIn: ["ON_HOLD"] } }, orderBy: { occurredAt: "desc" }, select: { status: true } });
  await prisma.$transaction((tx) => move(tx, s, before?.status ?? "REQUESTED", actor.id, "Released from hold"));
}

export async function cancelShippingOrder(actor: Actor, id: string, reason: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  if (["DELIVERED", "CANCELLED"].includes(s.status)) throw new UserError("This shipping order is already closed");
  if (s.shipment && !isAccepting(s.shipment)) throw new UserError(`It is already travelling in ${s.shipment.code} – put it on hold instead`);
  await prisma.$transaction(async (tx) => {
    await move(tx, s, "CANCELLED", actor.id, `Cancelled: ${reason}`, { shipmentId: null });
    if (s.shipmentId) await recalcTotals(tx, s.shipmentId);
  });
}

// ───────────────────────── Customer invoice message ─────────────────────────

type InvoiceFields = {
  number: number;
  shippingMethod: ShippingMethod;
  billWeightKg: Prisma.Decimal | null;
  billCbm: Prisma.Decimal | null;
  shipRatePerKgBdt: Prisma.Decimal | null;
  shipRatePerCbmBdt: Prisma.Decimal | null;
  shippingChargeBdt: Prisma.Decimal | null;
  qaFeeBdt: Prisma.Decimal | null;
  localDeliveryBdt: Prisma.Decimal | null;
  otherChargeBdt: Prisma.Decimal | null;
  discountBdt: Prisma.Decimal | null;
  invoiceTotalBdt: Prisma.Decimal | null;
};

export function shippingInvoiceMessage(s: InvoiceFields, customerName: string, paidBdt: Prisma.Decimal | string | number = 0) {
  const paid = D(paidBdt);
  const total = D(s.invoiceTotalBdt);
  const air = s.shippingMethod === "AIR";
  const lines = [
    `Dear ${customerName},`,
    `Invoice for shipment ${shippingNo(s)}:`,
    `• Shipping (${air ? `${s.billWeightKg} kg × ৳${s.shipRatePerKgBdt}` : `${s.billCbm} m³ × ৳${s.shipRatePerCbmBdt}`}): ৳${D(s.shippingChargeBdt).toFixed(2)}`,
  ];
  if (D(s.qaFeeBdt).gt(0)) lines.push(`• QA test: ৳${D(s.qaFeeBdt).toFixed(2)}`);
  if (D(s.localDeliveryBdt).gt(0)) lines.push(`• Home delivery: ৳${D(s.localDeliveryBdt).toFixed(2)}`);
  if (D(s.otherChargeBdt).gt(0)) lines.push(`• Other: ৳${D(s.otherChargeBdt).toFixed(2)}`);
  if (D(s.discountBdt).gt(0)) lines.push(`• Discount: −৳${D(s.discountBdt).toFixed(2)}`);
  lines.push(`Total: ৳${total.toFixed(2)}.`);
  if (paid.gt(0)) lines.push(`Paid: ৳${paid.toFixed(2)}. Balance due: ৳${total.sub(paid).toFixed(2)}.`);
  lines.push("Please pay so we can deliver to your address. Payment: bKash / Nagad / bank transfer. – SilkTrack");
  return lines.join("\n");
}

export async function markShippingInvoiceSent(actor: Actor, id: string, channel: "WHATSAPP" | "EMAIL" | "SMS") {
  assertCan(actor.role, "request:edit");
  const s = await prisma.shippingOrder.findUnique({ where: { id }, include: { customer: { select: { name: true } } } });
  if (!s) throw new UserError("Shipping order not found");
  if (!s.invoiceTotalBdt) throw new UserError("Invoice the order first");
  const paid = await paidFor(id);
  const how = { WHATSAPP: "WhatsApp", EMAIL: "email", SMS: "SMS" }[channel];
  await prisma.$transaction([
    prisma.notification.create({ data: { channel, type: "SHIPPING_INVOICE", title: `Invoice ${shippingNo(s)}`, body: shippingInvoiceMessage(s, s.customer.name, paid), customerId: s.customerId, status: "SENT", sentAt: new Date() } }),
    prisma.shippingOrderEvent.create({ data: { shippingOrderId: id, message: `Invoice sent to customer by ${how}`, createdById: actor.id } }),
  ]);
}

export function listShippingOrders(where: Prisma.ShippingOrderWhereInput = {}) {
  return prisma.shippingOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: { select: { id: true, code: true, name: true } }, items: { orderBy: { lineNo: "asc" } }, shipment: { select: { id: true, code: true } } },
  });
}
