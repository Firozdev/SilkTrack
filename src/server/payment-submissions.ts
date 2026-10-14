import "server-only";
import type { PaymentMethod, PaymentType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, sum, type Decimal } from "@/lib/money";
import { docNo } from "@/lib/format";
import { logChanges } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { recordPayment } from "./requests";
import { recordSamplePayment, sampleAmounts } from "./samples";
import { recordShippingPayment } from "./shipping-orders";
import type { Actor } from "./actor";

/**
 * Payments the customer reports in the portal ("I have paid" + transaction ID).
 * They never count until CS approves them; approval runs the same payment
 * function CS uses, so status changes (ready for delivery, purchase released…)
 * happen exactly as if CS had recorded it.
 */

export type PayTarget = { kind: "order" | "shipping" | "sample"; id: string };
export const submissionNo = (s: { number: number }) => `PS-${String(s.number).padStart(6, "0")}`;

const paidSum = (rows: { type: string; amountBdt: Decimal }[]) => sum(rows.map((p) => (p.type === "REFUND" ? D(p.amountBdt).neg() : D(p.amountBdt))));
const nonNeg = (d: Decimal) => (d.isNeg() ? D(0) : d);

/**
 * What the customer still owes on a bill, or null if nothing can be paid now.
 * Order: issued invoices if any, else the approved quote, minus order payments.
 */
export async function amountDue(customerId: string, t: PayTarget): Promise<{ due: Decimal; label: string } | null> {
  if (t.kind === "shipping") {
    const s = await prisma.shippingOrder.findFirst({ where: { id: t.id, customerId }, include: { payments: true } });
    if (!s || s.status !== "INVOICED" || !s.invoiceTotalBdt) return null;
    return { due: nonNeg(D(s.invoiceTotalBdt).sub(paidSum(s.payments))), label: docNo("shippingOrder", s.number) };
  }
  if (t.kind === "sample") {
    const s = await prisma.sample.findFirst({ where: { id: t.id, customerId }, include: { payments: true } });
    if (!s || !s.totalBdt || s.status === "CANCELLED") return null;
    return { due: sampleAmounts(s, paidSum(s.payments)).balance, label: docNo("sample", s.number) };
  }
  const o = await prisma.order.findFirst({
    where: { id: t.id, customerId },
    include: {
      payments: { where: { sampleId: null } },
      invoices: { where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, select: { totalBdt: true } },
      estimates: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1, select: { grandTotalBdt: true } },
    },
  });
  if (!o || ["CANCELLED", "ON_HOLD"].includes(o.status) || o.requestStatus === "REJECTED") return null;
  const total = o.invoices.length ? sum(o.invoices.map((i) => i.totalBdt)) : o.requestStatus === "CUSTOMER_APPROVED" ? D(o.estimates[0]?.grandTotalBdt) : D(0);
  if (total.lte(0)) return null;
  return { due: nonNeg(total.sub(paidSum(o.payments))), label: docNo("order", o.number) };
}

const targetWhere = (t: PayTarget) => (t.kind === "order" ? { orderId: t.id } : t.kind === "shipping" ? { shippingOrderId: t.id } : { sampleId: t.id });

export async function pendingTotal(t: PayTarget) {
  const rows = await prisma.paymentSubmission.findMany({ where: { ...targetWhere(t), status: "PENDING" }, select: { amountBdt: true } });
  return sum(rows.map((r) => r.amountBdt));
}

export type SubmitInput = { amountBdt: string; method: PaymentMethod; reference: string; paidAt: Date; note?: string };

export async function submitPayment(account: { accountId: string; customerId: string }, t: PayTarget, input: SubmitInput) {
  const due = await amountDue(account.customerId, t);
  if (!due) throw new UserError("Nothing is due on this order right now");
  const amount = D(input.amountBdt);
  if (amount.lte(0)) throw new UserError("Amount must be greater than zero");
  const reference = input.reference.trim();
  if (reference.length < 4) throw new UserError("Enter the transaction ID / reference");
  if (input.paidAt.getTime() > Date.now() + 86_400_000) throw new UserError("The payment date can't be in the future");
  const open = nonNeg(due.due.sub(await pendingTotal(t)));
  if (amount.gt(open)) throw new UserError(`That is more than the amount due (৳${open.toFixed(2)})`);
  const s = await prisma.paymentSubmission.create({
    data: { customerId: account.customerId, accountId: account.accountId, ...targetWhere(t), amountBdt: amount, method: input.method, reference, paidAt: input.paidAt, note: input.note?.trim() || null },
  });
  await logChanges(prisma, { entityType: "PaymentSubmission", entityId: s.id, userId: null, action: "CREATE" });
  await notifyRoles(["CS", "ADMIN"], {
    type: "PAYMENT_SUBMITTED",
    title: `Payment to verify: ${due.label} ৳${amount.toFixed(2)}`,
    body: `${input.method.replace(/_/g, " ").toLowerCase()} · ${reference} – check it and approve in Payments to verify.`,
    orderId: t.kind === "order" ? t.id : undefined,
  });
  return s;
}

/** Other payments / submissions already using this transaction reference. */
export async function duplicateReferences(reference: string, excludeSubmissionId?: string) {
  const ref = reference.trim();
  if (!ref) return { payments: 0, submissions: 0 };
  const [payments, submissions] = await Promise.all([
    prisma.payment.count({ where: { reference: { equals: ref, mode: "insensitive" }, submission: excludeSubmissionId ? { isNot: { id: excludeSubmissionId } } : undefined } }),
    prisma.paymentSubmission.count({ where: { reference: { equals: ref, mode: "insensitive" }, status: { not: "REJECTED" }, id: excludeSubmissionId ? { not: excludeSubmissionId } : undefined, paymentId: null } }),
  ]);
  return { payments, submissions };
}

/** Advance until the order is released for purchase, balance after. */
export async function defaultOrderPaymentType(orderId: string): Promise<PaymentType> {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { payments: { where: { type: "ADVANCE" }, select: { id: true } }, lines: { select: { status: true } } } });
  const purchased = o.lines.some((l) => !["REQUESTED", "QUOTED", "APPROVED", "CANCELLED", "ON_HOLD"].includes(l.status));
  return o.payments.length || purchased ? "BALANCE" : "ADVANCE";
}

export type ApproveEdits = { amountBdt?: string; method?: PaymentMethod; reference?: string; type?: "ADVANCE" | "BALANCE" };

/** CS approves (optionally correcting amount / method / reference first). */
export async function approveSubmission(actor: Actor, id: string, edits: ApproveEdits = {}) {
  assertCan(actor.role, "payment:record");
  const s = await prisma.paymentSubmission.findUnique({ where: { id } });
  if (!s) throw new UserError("Payment not found");
  if (s.status !== "PENDING") throw new UserError("This payment was already reviewed");
  const amountBdt = edits.amountBdt ?? s.amountBdt.toString();
  const method = edits.method ?? s.method;
  const reference = (edits.reference ?? s.reference).trim();
  // Claim it first so two people can't approve the same submission twice.
  const claimed = await prisma.paymentSubmission.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date() } });
  if (claimed.count !== 1) throw new UserError("This payment was already reviewed");
  let payment: { id: string };
  try {
    const input = { amountBdt, method, reference };
    if (s.shippingOrderId) payment = await recordShippingPayment(actor, s.shippingOrderId, input);
    else if (s.sampleId) payment = await recordSamplePayment(actor, s.sampleId, input);
    else payment = await recordPayment(actor, s.orderId!, { ...input, type: edits.type ?? (await defaultOrderPaymentType(s.orderId!)), paidAt: s.paidAt, note: `Reported by customer (${submissionNo(s)})` });
  } catch (e) {
    await prisma.paymentSubmission.update({ where: { id }, data: { status: "PENDING", reviewedById: null, reviewedAt: null } });
    throw e;
  }
  const changes = [
    { field: "status", oldValue: "PENDING", newValue: "APPROVED" },
    ...(D(amountBdt).eq(s.amountBdt) ? [] : [{ field: "amountBdt", oldValue: s.amountBdt.toString(), newValue: D(amountBdt).toString() }]),
    ...(method === s.method ? [] : [{ field: "method", oldValue: s.method, newValue: method }]),
    ...(reference === s.reference ? [] : [{ field: "reference", oldValue: s.reference, newValue: reference }]),
  ];
  await prisma.$transaction(async (tx) => {
    await tx.paymentSubmission.update({ where: { id }, data: { paymentId: payment.id, amountBdt, method, reference } });
    await logChanges(tx, { entityType: "PaymentSubmission", entityId: id, userId: actor.id, action: "UPDATE", changes });
  });
}

export async function rejectSubmission(actor: Actor, id: string, reason: string) {
  assertCan(actor.role, "payment:record");
  if (!reason.trim()) throw new UserError("Give a reason the customer will see");
  const claimed = await prisma.paymentSubmission.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", rejectReason: reason.trim(), reviewedById: actor.id, reviewedAt: new Date() } });
  if (claimed.count !== 1) throw new UserError("This payment was already reviewed");
  await logChanges(prisma, { entityType: "PaymentSubmission", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "status", oldValue: "PENDING", newValue: "REJECTED" }] });
}

export function listSubmissions(where: Prisma.PaymentSubmissionWhereInput, take = 100) {
  return prisma.paymentSubmission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      customer: { select: { id: true, code: true, name: true, phone: true } },
      order: { select: { id: true, number: true } },
      shippingOrder: { select: { id: true, number: true } },
      sample: { select: { id: true, number: true } },
      reviewedBy: { select: { name: true } },
      attachments: { select: { id: true, fileName: true, mimeType: true, uploadedByAccountId: true } },
    },
  });
}
