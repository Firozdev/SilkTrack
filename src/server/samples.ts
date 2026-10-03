import "server-only";
import type { PaymentMethod, Prisma, SampleShippingMode, SampleStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, can } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, allocate, cbmOf, money, rmbToBdt, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { diffFields, logChanges } from "@/lib/audit";
import { notifyRoles, queueCustomerMessage } from "@/lib/notify";
import { rateForConversion } from "./rates";
import { isAccepting, recalcTotals } from "./shipments";
import { findOrCreateCustomer, type CustomerInput } from "./requests";
import type { Actor } from "./actor";

type Tx = Prisma.TransactionClient;

export const SAMPLE_FLOW: SampleStatus[] = ["REQUESTED", "INVOICED", "AWAITING_PAYMENT", "PAID", "PURCHASED", "SHIPPED", "RECEIVED_BD", "DELIVERED"];

async function load(id: string) {
  const s = await prisma.sample.findUnique({ where: { id }, include: { order: { select: { id: true, number: true } }, customer: { select: { id: true, code: true, name: true } } } });
  if (!s) throw new UserError("Sample not found");
  return s;
}

/** "REQ-000012" for request samples, "C-00042 (stand-alone)" otherwise – for messages. */
function ref(s: { order: { number: number } | null; customer: { code: string } }): string {
  return s.order ? docNo("order", s.order.number) : `${s.customer.code} (stand-alone)`;
}

/** Status change + audit + timeline entry for the sample. */
async function move(tx: Tx, s: { id: string; status: SampleStatus }, to: SampleStatus, actorId: string, message: string, data: Prisma.SampleUncheckedUpdateInput = {}) {
  await tx.sample.update({ where: { id: s.id }, data: { ...data, status: to } });
  await logChanges(tx, { entityType: "Sample", entityId: s.id, userId: actorId, action: "UPDATE", changes: s.status === to ? [] : [{ field: "status", oldValue: s.status, newValue: to }] });
  await tx.sampleEvent.create({ data: { sampleId: s.id, status: to, message, createdById: actorId } });
}

const label = (s: { number: number }) => docNo("sample", s.number);

/**
 * When the last open sample of a request is delivered or cancelled, the
 * request leaves "Sampling": back to Quoted if the quotation was sent to the
 * customer, otherwise to Sent to China.
 */
async function endSampling(tx: Tx, orderId: string, actorId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { requestStatus: true } });
  if (order.requestStatus !== "SAMPLING") return;
  const open = await tx.sample.count({ where: { orderId, status: { notIn: ["DELIVERED", "CANCELLED"] } } });
  if (open > 0) return;
  const sent = await tx.estimate.count({ where: { orderId, status: "SENT_TO_CUSTOMER" } });
  const next = sent ? "QUOTED" : "SENT_TO_CHINA";
  await tx.order.update({ where: { id: orderId }, data: { requestStatus: next } });
  await logChanges(tx, { entityType: "Order", entityId: orderId, userId: actorId, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: "SAMPLING", newValue: next }] });
}
export { label as sampleNo };

/** BD asks for a sample once China has quoted the request. */
export async function requestSample(actor: Actor, orderId: string, input: { lines: { orderLineId: string; quantity: number }[]; note?: string }) {
  assertCan(actor.role, "request:edit");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true, estimates: { where: { status: { not: "DRAFT" } }, select: { id: true } } } });
  if (!order) throw new UserError("Request not found");
  if (["CANCELLED", "DELIVERED"].includes(order.status) || order.requestStatus === "REJECTED") throw new UserError("This order is closed");
  if (!order.estimates.length) throw new UserError("Samples can be requested after the China team submits the quotation");
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw new UserError("Choose at least one product and quantity for the sample");
  const valid = new Set(order.lines.filter((l) => l.status !== "CANCELLED").map((l) => l.id));
  if (lines.some((l) => !valid.has(l.orderLineId))) throw new UserError("Unknown product");

  const s = await prisma.$transaction(async (tx) => {
    if (order.requestStatus === "SENT_TO_CHINA" || order.requestStatus === "QUOTED") {
      await tx.order.update({ where: { id: orderId }, data: { requestStatus: "SAMPLING" } });
      await logChanges(tx, { entityType: "Order", entityId: orderId, userId: actor.id, action: "UPDATE", changes: [{ field: "requestStatus", oldValue: order.requestStatus, newValue: "SAMPLING" }] });
    }
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    const s = await tx.sample.create({
      data: {
        orderId,
        customerId: order.customerId,
        requestedById: actor.id,
        requestNote: input.note,
        lines: {
          create: lines.map((l) => {
            const ol = byId.get(l.orderLineId)!;
            return { orderLineId: ol.id, productName: ol.productName, variant: [ol.color, ol.size, ol.model].filter(Boolean).join(" · ") || null, quantity: l.quantity };
          }),
        },
        events: { create: { status: "REQUESTED", message: `Sample requested${input.note ? `: ${input.note}` : ""}`, createdById: actor.id } },
      },
    });
    await logChanges(tx, { entityType: "Sample", entityId: s.id, userId: actor.id, action: "CREATE" });
    return s;
  });
  await notifyRoles(["PURCHASE"], { type: "SAMPLE_REQUESTED", title: `Sample requested: ${docNo("order", order.number)}`, body: `${label(s)} – prepare the sample invoice.`, orderId });
  return s;
}

export type StandaloneSampleInput = {
  customer: CustomerInput;
  lines: { productName: string; variant?: string; link?: string; quantity: number }[];
  note?: string;
};

/** BD creates a sample for a customer without any request. */
export async function createStandaloneSample(actor: Actor, input: StandaloneSampleInput) {
  assertCan(actor.role, "request:edit");
  const lines = input.lines.filter((l) => l.productName.trim() && l.quantity > 0);
  if (!lines.length) throw new UserError("Add at least one product with a quantity");
  const s = await prisma.$transaction(async (tx) => {
    const customer = await findOrCreateCustomer(tx, input.customer, actor.id);
    const s = await tx.sample.create({
      data: {
        customerId: customer.id,
        requestedById: actor.id,
        requestNote: input.note,
        lines: { create: lines.map((l) => ({ productName: l.productName.trim(), variant: l.variant, link: l.link, quantity: l.quantity })) },
        events: { create: { status: "REQUESTED", message: `Stand-alone sample created${input.note ? `: ${input.note}` : ""}`, createdById: actor.id } },
      },
      include: { customer: { select: { code: true } } },
    });
    await logChanges(tx, { entityType: "Sample", entityId: s.id, userId: actor.id, action: "CREATE" });
    return s;
  });
  await notifyRoles(["PURCHASE"], { type: "SAMPLE_REQUESTED", title: `Sample requested: ${label(s)}`, body: `Stand-alone sample for ${s.customer.code} – prepare the sample invoice.` });
  return s;
}

export type SampleSizeInput = { weightKg?: string; cartonCount?: number; lengthCm?: string; widthCm?: string; heightCm?: string };

/** Size fields to store; CBM = (L × W × H / 1,000,000) × cartons (1 carton if not given). Undefined when nothing entered. */
export function sampleSize(size: SampleSizeInput | undefined) {
  if (!size) return undefined;
  const { weightKg, cartonCount, lengthCm, widthCm, heightCm } = size;
  if (!weightKg && !cartonCount && !lengthCm && !widthCm && !heightCm) return undefined;
  const cartons = cartonCount ?? (lengthCm && widthCm && heightCm ? 1 : null);
  const cbm = lengthCm && widthCm && heightCm ? cbmOf(lengthCm, widthCm, heightCm).mul(cartons ?? 1) : null;
  return { weightKg: weightKg ?? null, cartonCount: cartons, lengthCm: lengthCm ?? null, widthCm: widthCm ?? null, heightCm: heightCm ?? null, cbm };
}

export type SampleInvoiceInput = {
  productRmb: string;
  chinaShippingRmb?: string;
  /** Leave blank to calculate from size × rate. */
  shippingToBdRmb?: string;
  shippingRatePerKgRmb?: string;
  shippingRatePerCbmRmb?: string;
  serviceRmb?: string;
  paymentRequired: boolean;
  size?: SampleSizeInput;
};

/** China prepares the customer's sample invoice and decides if payment must come first. */
export async function invoiceSample(actor: Actor, id: string, input: SampleInvoiceInput) {
  assertCan(actor.role, "estimate:edit");
  const s = await load(id);
  if (!["REQUESTED", "INVOICED", "AWAITING_PAYMENT"].includes(s.status)) throw new UserError("The sample invoice can't be changed now");
  const { exchangeRateId, rateUsed } = await rateForConversion();
  const size = sampleSize(input.size);
  let shippingToBdRmb: string | Prisma.Decimal | undefined = input.shippingToBdRmb;
  if (!shippingToBdRmb && input.shippingRatePerKgRmb && size?.weightKg) shippingToBdRmb = money(D(size.weightKg).mul(D(input.shippingRatePerKgRmb)));
  else if (!shippingToBdRmb && input.shippingRatePerCbmRmb && size?.cbm) shippingToBdRmb = money(size.cbm.mul(D(input.shippingRatePerCbmRmb)));
  const totalRmb = money(sum([input.productRmb, input.chinaShippingRmb, shippingToBdRmb, input.serviceRmb]));
  if (totalRmb.lte(0)) throw new UserError("The invoice total must be more than zero");
  const totalBdt = rmbToBdt(totalRmb, rateUsed);
  const to: SampleStatus = input.paymentRequired ? "AWAITING_PAYMENT" : "INVOICED";
  await prisma.$transaction(async (tx) => {
    await logChanges(tx, {
      entityType: "Sample",
      entityId: s.id,
      userId: actor.id,
      action: "UPDATE",
      changes: diffFields(s, {
        shippingRatePerKgRmb: input.shippingRatePerKgRmb ? D(input.shippingRatePerKgRmb) : null,
        shippingRatePerCbmRmb: !input.shippingRatePerKgRmb && input.shippingRatePerCbmRmb ? D(input.shippingRatePerCbmRmb) : null,
        totalRmb,
      }),
    });
    await move(tx, s, to, actor.id, `Sample invoice ¥${totalRmb.toFixed(2)} (৳${totalBdt.toFixed(2)} @ ${rateUsed.toString()}) – ${input.paymentRequired ? "payment required before purchase" : "no payment needed before purchase"}`, {
      productRmb: input.productRmb,
      chinaShippingRmb: input.chinaShippingRmb ?? null,
      shippingToBdRmb: shippingToBdRmb ?? null,
      shippingRatePerKgRmb: input.shippingRatePerKgRmb ?? null,
      shippingRatePerCbmRmb: input.shippingRatePerKgRmb ? null : (input.shippingRatePerCbmRmb ?? null),
      ...(size ?? {}),
      serviceRmb: input.serviceRmb ?? null,
      totalRmb,
      exchangeRateId,
      rateUsed,
      totalBdt,
      paymentRequired: input.paymentRequired,
      invoicedById: actor.id,
      invoicedAt: new Date(),
    });
  });
  await notifyRoles(["CS", "ADMIN"], {
    type: "SAMPLE_INVOICED",
    title: `Sample invoice: ${label(s)} (${ref(s)})`,
    body: `৳${totalBdt.toFixed(2)}. ${input.paymentRequired ? "Collect payment from the customer and record it." : "China will buy the sample without waiting for payment."}`,
    orderId: s.orderId,
  });
}

/** BD confirms the customer paid for the sample. */
type AmountFields = {
  totalBdt: Prisma.Decimal | null;
  productRmb: Prisma.Decimal | null;
  chinaShippingRmb: Prisma.Decimal | null;
  serviceRmb: Prisma.Decimal | null;
  shippingToBdRmb: Prisma.Decimal | null;
};

/**
 * Split of the sample invoice in BDT: the purchase part (sample price + China
 * shipping + service) is collected before buying when payment is required;
 * the shipping to Bangladesh is collected on delivery.
 */
export function sampleAmounts(s: AmountFields, paidBdt: Prisma.Decimal | string | number = 0) {
  const total = D(s.totalBdt);
  const purchaseRmb = sum([s.productRmb, s.chinaShippingRmb, s.serviceRmb]);
  const [beforePurchase, onDelivery] = total.isZero() ? [D(0), D(0)] : allocate(total, [purchaseRmb, D(s.shippingToBdRmb)]);
  const paid = D(paidBdt);
  const balance = total.sub(paid);
  return {
    total,
    beforePurchase,
    onDelivery,
    paid,
    balance: balance.isNeg() ? D(0) : balance,
    /** Still needed before China may buy. */
    upfrontDue: beforePurchase.sub(paid).isNeg() ? D(0) : beforePurchase.sub(paid),
  };
}

async function paidFor(sampleId: string, db: Pick<typeof prisma, "payment"> | Tx = prisma) {
  const rows = await db.payment.findMany({ where: { sampleId }, select: { type: true, amountBdt: true } });
  return sum(rows.map((r) => (r.type === "REFUND" ? D(r.amountBdt).neg() : r.amountBdt)));
}

async function addSamplePayment(tx: Tx, s: { id: string; orderId: string | null }, actorId: string, input: { amountBdt: string; method: PaymentMethod; reference?: string }, note: string) {
  const p = await tx.payment.create({
    data: { orderId: s.orderId, sampleId: s.id, type: "SAMPLE", amountBdt: input.amountBdt, method: input.method, reference: input.reference, receivedById: actorId, paidAt: new Date() },
  });
  await logChanges(tx, { entityType: "Payment", entityId: p.id, userId: actorId, action: "CREATE" });
  await tx.sampleEvent.create({ data: { sampleId: s.id, message: `${note} ৳${D(input.amountBdt).toFixed(2)} (${input.method.toLowerCase().replace(/_/g, " ")})`, createdById: actorId } });
}

/** BD records money received for the sample. Can't exceed the remaining balance. */
export async function recordSamplePayment(actor: Actor, id: string, input: { amountBdt: string; method: PaymentMethod; reference?: string }) {
  assertCan(actor.role, "payment:record");
  const s = await load(id);
  if (!s.totalBdt) throw new UserError("China has not invoiced this sample yet");
  if (s.status === "CANCELLED") throw new UserError("This sample is cancelled");
  const amount = D(input.amountBdt);
  if (amount.lte(0)) throw new UserError("Amount must be greater than zero");
  const before = sampleAmounts(s, await paidFor(s.id));
  if (amount.gt(before.balance)) throw new UserError(`That is more than the balance due (৳${before.balance.toFixed(2)})`);
  const after = sampleAmounts(s, before.paid.add(amount));
  const released = s.status === "AWAITING_PAYMENT" && after.upfrontDue.isZero();
  await prisma.$transaction(async (tx) => {
    await addSamplePayment(tx, s, actor.id, input, s.status === "AWAITING_PAYMENT" && !released ? "Partial payment" : "Payment received");
    if (released) await move(tx, s, "PAID", actor.id, "Purchase amount paid – China can buy the sample");
  });
  if (released) await notifyRoles(["PURCHASE"], { type: "SAMPLE_PAID", title: `Sample paid – buy now: ${label(s)}`, body: ref(s), orderId: s.orderId });
}

export type SamplePurchaseInput = { supplierName: string; supplierOrderNo?: string; purchaseTrackingUrl: string; expectedAtWarehouseAt: Date };

export async function purchaseSample(actor: Actor, id: string, input: SamplePurchaseInput) {
  assertCan(actor.role, "purchase:edit");
  const s = await load(id);
  if (s.status === "AWAITING_PAYMENT") throw new UserError("Waiting for the BD team to confirm the sample payment");
  if (!["INVOICED", "PAID"].includes(s.status)) throw new UserError("Invoice the sample before purchasing");
  if (!/^https?:\/\//i.test(input.purchaseTrackingUrl.trim())) throw new UserError("Tracking URL must start with http:// or https://");
  await prisma.$transaction((tx) =>
    move(tx, s, "PURCHASED", actor.id, `Sample purchased from ${input.supplierName}`, {
      supplierName: input.supplierName,
      supplierOrderNo: input.supplierOrderNo ?? null,
      purchaseTrackingUrl: input.purchaseTrackingUrl.trim(),
      expectedAtWarehouseAt: input.expectedAtWarehouseAt,
      purchasedById: actor.id,
      purchasedAt: new Date(),
    }),
  );
  await notifyRoles(["CS"], { type: "SAMPLE_PURCHASED", title: `Sample purchased: ${label(s)}`, body: ref(s), orderId: s.orderId });
}

export type SampleShipInput = {
  shippingMode: SampleShippingMode;
  carrierName?: string;
  trackingNo?: string;
  trackingUrl?: string;
  /** Required for a planned shipment. */
  shipmentId?: string;
  etaBd?: Date;
  size?: SampleSizeInput;
};

/**
 * China sends the sample to Bangladesh: in a planned shipment (chosen from
 * the planned list, counted in its weight/CBM) or by another method
 * (express, hand carry, post, other) with its own carrier and tracking.
 */
export async function shipSample(actor: Actor, id: string, input: SampleShipInput) {
  assertCan(actor.role, "purchase:edit");
  const s = await load(id);
  if (!["PURCHASED", "SHIPPED"].includes(s.status)) throw new UserError("Purchase the sample before shipping it");
  const planned = input.shippingMode === "WEEKLY_SHIPMENT";
  let sh: { id: string; code: string; etaBd: Date | null } | null = null;
  if (planned) {
    if (!input.shipmentId) throw new UserError("Choose the planned shipment");
    const found = await prisma.shipment.findUnique({ where: { id: input.shipmentId } });
    if (!found || (s.shipmentId !== found.id && !isAccepting(found))) throw new UserError("That shipment is not accepting items");
    sh = found;
  } else if (input.shippingMode === "EXPRESS_COURIER" && !input.trackingNo) {
    throw new UserError("Enter the courier tracking number");
  }
  const size = sampleSize(input.size);
  const how = sh ? `planned shipment ${sh.code}` : [input.shippingMode.replace(/_/g, " ").toLowerCase(), input.carrierName, input.trackingNo].filter(Boolean).join(" · ");
  await prisma.$transaction(async (tx) => {
    await move(tx, s, "SHIPPED", actor.id, `Sent to Bangladesh by ${how}`, {
      shippingMode: input.shippingMode,
      carrierName: planned ? null : (input.carrierName ?? null),
      trackingNo: planned ? null : (input.trackingNo ?? null),
      trackingUrl: planned ? null : (input.trackingUrl ?? null),
      shipmentId: sh?.id ?? null,
      etaBd: input.etaBd ?? sh?.etaBd ?? null,
      shippedAt: s.shippedAt ?? new Date(),
      ...(size ?? {}),
    });
    if (size) {
      await logChanges(tx, { entityType: "Sample", entityId: s.id, userId: actor.id, action: "UPDATE", changes: diffFields(s, { weightKg: size.weightKg ? D(size.weightKg) : null, cbm: size.cbm }) });
    }
    // Keep planned-shipment totals right (old and new shipment).
    for (const shipmentId of new Set([s.shipmentId, sh?.id].filter((x): x is string => !!x))) await recalcTotals(tx, shipmentId);
  });
  await notifyRoles(["CS", "ADMIN"], { type: "SAMPLE_SHIPPED", title: `Sample on the way: ${label(s)}`, body: how, orderId: s.orderId });
}

export async function receiveSampleBd(actor: Actor, id: string) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  if (s.status !== "SHIPPED") throw new UserError("The sample has not been shipped yet");
  await prisma.$transaction((tx) => move(tx, s, "RECEIVED_BD", actor.id, "Sample received in Bangladesh", { receivedBdAt: new Date() }));
  await queueCustomerMessage(s.customerId, "WHATSAPP", { type: "SAMPLE_ARRIVED", title: "Sample arrived", body: `Your sample ${label(s)} has arrived in Bangladesh.`, orderId: s.orderId });
}

/**
 * Hand the sample to the customer, optionally collecting the remaining
 * balance (usually the shipping due) at the same time.
 */
export async function deliverSample(actor: Actor, id: string, feedback?: string, collect?: { amountBdt: string; method: PaymentMethod; reference?: string }) {
  assertCan(actor.role, "request:edit");
  const s = await load(id);
  if (s.status !== "RECEIVED_BD") throw new UserError("Mark the sample as received in Bangladesh first");
  if (collect && D(collect.amountBdt).gt(0)) {
    assertCan(actor.role, "payment:record");
    const due = sampleAmounts(s, await paidFor(s.id)).balance;
    if (D(collect.amountBdt).gt(due)) throw new UserError(`That is more than the balance due (৳${due.toFixed(2)})`);
  }
  await prisma.$transaction(async (tx) => {
    if (collect && D(collect.amountBdt).gt(0)) await addSamplePayment(tx, s, actor.id, collect, "Collected on delivery");
    await move(tx, s, "DELIVERED", actor.id, `Delivered to customer${feedback ? ` – feedback: ${feedback}` : ""}`, { deliveredAt: new Date(), customerFeedback: feedback ?? null });
    if (s.orderId) await endSampling(tx, s.orderId, actor.id);
  });
  await notifyRoles(["PURCHASE"], { type: "SAMPLE_DELIVERED", title: `Sample delivered: ${label(s)}`, body: feedback ? `Customer feedback: ${feedback}` : "Delivered to the customer.", orderId: s.orderId });
}

/** Balance due for a sample (for pages). */
export async function sampleBalance(s: AmountFields & { id: string }) {
  return sampleAmounts(s, await paidFor(s.id));
}

export async function cancelSample(actor: Actor, id: string, reason: string) {
  if (!can(actor.role, "request:edit") && !can(actor.role, "purchase:edit")) assertCan(actor.role, "request:edit");
  const s = await load(id);
  if (["DELIVERED", "CANCELLED"].includes(s.status)) throw new UserError("This sample is already closed");
  await prisma.$transaction(async (tx) => {
    await move(tx, s, "CANCELLED", actor.id, `Cancelled: ${reason}`);
    if (s.orderId) await endSampling(tx, s.orderId, actor.id);
  });
}

/** Customer-facing message for the sample invoice. */
export function sampleInvoiceMessage(
  s: AmountFields & { number: number; paymentRequired: boolean | null; order: { number: number } | null },
  customerName: string,
  paidBdt: Prisma.Decimal | string | number = 0,
) {
  const a = sampleAmounts(s, paidBdt);
  const lines = [
    `Dear ${customerName},`,
    `Sample invoice ${label(s)}${s.order ? ` for your order ${docNo("order", s.order.number)}` : ""}: ৳${a.total.toFixed(2)}.`,
  ];
  if (a.onDelivery.gt(0)) lines.push(`• Product (before purchase): ৳${a.beforePurchase.toFixed(2)}`, `• Shipping to Bangladesh (on delivery): ৳${a.onDelivery.toFixed(2)}`);
  if (a.paid.gt(0)) lines.push(`Paid so far: ৳${a.paid.toFixed(2)}. Balance due: ৳${a.balance.toFixed(2)}.`);
  else lines.push(s.paymentRequired ? `Please pay ৳${a.beforePurchase.toFixed(2)} so we can buy the sample${a.onDelivery.gt(0) ? "; the shipping is paid on delivery" : ""}.` : "We are buying the sample now; please pay when convenient.");
  lines.push("Payment: bKash / Nagad / bank transfer. – SilkTrack");
  return lines.join("\n");
}

/** BD sends the sample invoice to the customer (logged on the sample timeline). */
export async function markSampleInvoiceSent(actor: Actor, id: string, channel: "WHATSAPP" | "EMAIL" | "SMS") {
  assertCan(actor.role, "request:edit");
  const s = await prisma.sample.findUnique({ where: { id }, include: { order: { select: { number: true } }, customer: { select: { name: true } } } });
  if (!s) throw new UserError("Sample not found");
  if (!s.totalBdt) throw new UserError("China has not invoiced this sample yet");
  const paid = await paidFor(s.id);
  const how = { WHATSAPP: "WhatsApp", EMAIL: "email", SMS: "SMS" }[channel];
  await prisma.$transaction([
    prisma.notification.create({
      data: { channel, type: "SAMPLE_INVOICE", title: `Sample invoice ${label(s)}`, body: sampleInvoiceMessage(s, s.customer.name, paid), customerId: s.customerId, orderId: s.orderId, status: "SENT", sentAt: new Date() },
    }),
    prisma.sampleEvent.create({ data: { sampleId: s.id, message: `Invoice sent to customer by ${how}`, createdById: actor.id } }),
  ]);
}

export function listSamples(where: Prisma.SampleWhereInput = {}) {
  return prisma.sample.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    take: 200,
    include: {
      order: { select: { id: true, number: true } },
      customer: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });
}
