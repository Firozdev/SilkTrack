import "server-only";
import type { DeliveryCourier, PaymentMethod, Prisma, QaResult, ReceivingCondition, ShippingMethod, ShippingOrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, can } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, cbmOf, money, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { diffFields, logChanges } from "@/lib/audit";
import { notifyRoles, queueCustomerMessage } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { rateForConversion } from "./rates";
import { capacityWarning, isAccepting, recalcTotals, suggestShipment } from "./shipments";
import { findOrCreateCustomer, type CustomerInput } from "./requests";
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
  const items = input.items.filter((i) => i.productName.trim() && i.quantity > 0);
  if (!items.length) throw new UserError("Add at least one product with a quantity");
  const s = await prisma.$transaction(async (tx) => {
    const customer = await findOrCreateCustomer(tx, input.customer, actor.id);
    const s = await tx.shippingOrder.create({
      data: {
        customerId: customer.id,
        source: "STAFF",
        createdById: actor.id,
        shippingMethod: input.shippingMethod,
        qaRequested: input.qaRequested,
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
        events: { create: { status: "REQUESTED", message: `Shipping-only request (${input.shippingMethod.toLowerCase()}${input.qaRequested ? ", QA test requested" : ""})`, createdById: actor.id } },
      },
    });
    await logChanges(tx, { entityType: "ShippingOrder", entityId: s.id, userId: actor.id, action: "CREATE" });
    return s;
  });
  await notifyRoles(["PURCHASE"], {
    type: "SHIPPING_ORDER_NEW",
    title: `Shipping order: ${shippingNo(s)}`,
    body: `${items.length} parcel(s) expected at the China warehouse${input.qaRequested ? " – QA test requested" : ""}.`,
  });
  return s;
}

/** Customer / supplier tracking numbers usually arrive later; editable until the goods are received. */
export async function updateShippingTracking(actor: Actor, id: string, items: { itemId: string; courierName?: string; trackingNo?: string }[]) {
  if (!can(actor.role, "request:edit")) assertCan(actor.role, "receiving:edit");
  const s = await load(id);
  requireStatus(s, ["REQUESTED"], "Tracking can only be changed before the goods are received");
  const own = new Set((await prisma.shippingOrderItem.findMany({ where: { shippingOrderId: id }, select: { id: true } })).map((i) => i.id));
  if (items.some((i) => !own.has(i.itemId))) throw new UserError("Unknown item");
  await prisma.$transaction(async (tx) => {
    for (const i of items) await tx.shippingOrderItem.update({ where: { id: i.itemId }, data: { courierName: i.courierName ?? null, trackingNo: i.trackingNo?.trim() || null } });
    await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: "Supplier tracking updated", createdById: actor.id } });
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
  if (first || problems.length) {
    await notifyRoles(["CS", "ADMIN"], {
      type: problems.length ? "SHIPPING_ORDER_ISSUE" : "SHIPPING_ORDER_RECEIVED",
      title: `${problems.length ? "Problem receiving" : "Received in China"}: ${shippingNo(s)}`,
      body: problems.length
        ? problems.map((p) => `${byId.get(p.itemId)!.productName}: ${p.quantityReceived}/${byId.get(p.itemId)!.quantity} ${p.condition.toLowerCase().replace(/_/g, " ")}`).join("; ")
        : `${grossWeightKg.toString()} kg · ${cbm.toString()} m³${s.qaRequested ? " – QA test next" : ""}`,
    });
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
  await notifyRoles(["CS", "ADMIN"], {
    type: input.result === "PASSED" ? "SHIPPING_QA_PASSED" : "SHIPPING_QA_FAILED",
    title: `QA ${input.result === "PASSED" ? "passed" : "failed"}: ${shippingNo(s)}`,
    body: input.result === "PASSED" ? (input.notes ?? "Ready to ship.") : `${input.notes ?? "See the QA photos."} Tell the China team to ship anyway, or put the order on hold.`,
  });
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
  return { shipment: sh, warning: capacityWarning(sh) };
}

// ───────────────────────── Bangladesh ─────────────────────────

export async function receiveShippingBd(actor: Actor, id: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["IN_SHIPMENT"], "The order is not in a shipment yet");
  await prisma.$transaction((tx) => move(tx, s, "RECEIVED_BD", actor.id, `Received in Bangladesh${s.shipment ? ` (${s.shipment.code})` : ""}`, { receivedBdAt: new Date() }));
  await queueCustomerMessage(s.customerId, "WHATSAPP", { type: "SHIPPING_ARRIVED", title: "Arrived in Bangladesh", body: `Your shipment ${shippingNo(s)} has arrived in Bangladesh. We will send the bill shortly.` });
}

/** Default BDT shipping rates: the Admin setting, else the rate on the last invoice of that method. */
export async function defaultShippingRates() {
  const [air, sea, qa] = await Promise.all([getSetting("shipping_service_air_per_kg_bdt"), getSetting("shipping_service_sea_per_cbm_bdt"), getSetting("shipping_service_qa_fee_bdt")]);
  const last = async (method: ShippingMethod) =>
    prisma.shippingOrder.findFirst({ where: { shippingMethod: method, invoicedAt: { not: null } }, orderBy: { invoicedAt: "desc" }, select: { shipRatePerKgBdt: true, shipRatePerCbmBdt: true } });
  const [lastAir, lastSea] = await Promise.all([air ? null : last("AIR"), sea ? null : last("SEA")]);
  return {
    perKgBdt: air || lastAir?.shipRatePerKgBdt?.toString() || "",
    perCbmBdt: sea || lastSea?.shipRatePerCbmBdt?.toString() || "",
    qaFeeBdt: qa,
    localDeliveryBdt: await getSetting("default_local_delivery_bdt"),
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
};

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
    });
  });
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
  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { shippingOrderId: id, type: "SHIPPING_SERVICE", amountBdt: amount, method: input.method, reference: input.reference, receivedById: actor.id, paidAt: new Date() },
    });
    await logChanges(tx, { entityType: "Payment", entityId: p.id, userId: actor.id, action: "CREATE" });
    const msg = `${settled ? "Payment received" : "Partial payment"} ৳${amount.toFixed(2)} (${input.method.toLowerCase().replace(/_/g, " ")})`;
    if (settled) await move(tx, s, "READY_FOR_DELIVERY", actor.id, `${msg} – fully paid, ready for delivery`);
    else await tx.shippingOrderEvent.create({ data: { shippingOrderId: id, message: msg, createdById: actor.id } });
  });
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
}

export async function deliverShipping(actor: Actor, id: string, receiverName?: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  requireStatus(s, ["OUT_FOR_DELIVERY"], "Dispatch the order first");
  await prisma.$transaction((tx) => move(tx, s, "DELIVERED", actor.id, `Delivered${receiverName ? ` – received by ${receiverName}` : ""}`, { deliveredAt: new Date(), receiverName: receiverName ?? null }));
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
