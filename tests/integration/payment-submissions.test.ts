import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { portalAttachment } from "@/server/portal";
import { amountDue, approveSubmission, duplicateReferences, rejectSubmission, submitPayment } from "@/server/payment-submissions";
import { confirmReceipt } from "@/server/receipts";
import { createPortalRequest } from "@/server/requests";
import { saveQuotation, setSellingPrices, submitQuotation, sendQuotationToCustomer, decidePortalQuotation } from "@/server/estimates";
import { assignShippingOrder, createPortalShippingOrder, dispatchShipping, invoiceShipping, receiveShippingBd, receiveShippingChina, recordShippingPayment } from "@/server/shipping-orders";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const PAID = new Date("2026-10-05T00:00:00Z");

async function customer(phone: string, name = "Karim") {
  const acc = await signUp({ name, phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  return { accountId: a.id, customerId: a.customerId! };
}

/** Shipping order invoiced at 12.5 kg × ৳800 = ৳10,000. */
async function invoicedShipping(customerId: string) {
  const so = await createPortalShippingOrder(customerId, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] });
  const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
  await receiveShippingChina(china, so.id, { items: [{ itemId: item.id, quantityReceived: 2, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "12.5" }] });
  await assignShippingOrder(china, so.id, "auto");
  await receiveShippingBd(cs, so.id);
  await invoiceShipping(cs, so.id, { ratePerUnitBdt: "800" });
  return so;
}

describe("Customer-reported payments", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("customer reports, CS corrects and approves; fully paid → ready for delivery", async () => {
    const k = await customer("01711000000");
    const so = await invoicedShipping(k.customerId);
    const t = { kind: "shipping" as const, id: so.id };
    expect((await amountDue(k.customerId, t))?.due.toString()).toBe("10000");

    await expect(submitPayment(k, t, { amountBdt: "10001", method: "BKASH", reference: "TRX12345", paidAt: PAID })).rejects.toThrow(/more than the amount due/);
    await expect(submitPayment(k, t, { amountBdt: "100", method: "BKASH", reference: "x", paidAt: PAID })).rejects.toThrow(/transaction ID/);
    const s1 = await submitPayment(k, t, { amountBdt: "6000", method: "BKASH", reference: "TRX11111", paidAt: PAID });
    expect(await prisma.notification.count({ where: { type: "PAYMENT_SUBMITTED", userId: cs.id } })).toBe(1);
    // Pending reports count against what can still be reported
    await expect(submitPayment(k, t, { amountBdt: "4001", method: "NAGAD", reference: "TRX22222", paidAt: PAID })).rejects.toThrow(/৳4000.00/);

    // Nothing counts until approved
    expect((await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("INVOICED");
    await expect(approveSubmission(china, s1.id)).rejects.toThrow(ForbiddenError);

    // CS sees the customer typed the amount wrong: it was 5000
    await approveSubmission(cs, s1.id, { amountBdt: "5000" });
    const a1 = await prisma.paymentSubmission.findUniqueOrThrow({ where: { id: s1.id }, include: { payment: true } });
    expect([a1.status, a1.amountBdt.toString(), a1.payment?.amountBdt.toString(), a1.payment?.reference]).toEqual(["APPROVED", "5000", "5000", "TRX11111"]);
    await expect(approveSubmission(cs, s1.id)).rejects.toThrow(/already reviewed/);
    const audit = await prisma.auditLog.findMany({ where: { entityType: "PaymentSubmission", entityId: s1.id, action: "UPDATE" } });
    expect(audit.map((x) => x.field).sort()).toEqual(["amountBdt", "status"]);

    const s2 = await submitPayment(k, t, { amountBdt: "5000", method: "NAGAD", reference: "TRX22222", paidAt: PAID });
    await approveSubmission(cs, s2.id);
    expect((await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("READY_FOR_DELIVERY");
    expect(await amountDue(k.customerId, t)).toBeNull();
  });

  it("rejects with a reason; other customers can't report on someone else's bill", async () => {
    const k = await customer("01711000000");
    const other = await customer("01811000000", "B");
    const so = await invoicedShipping(k.customerId);
    const t = { kind: "shipping" as const, id: so.id };
    await expect(submitPayment(other, t, { amountBdt: "100", method: "BKASH", reference: "TRX99999", paidAt: PAID })).rejects.toThrow(/Nothing is due/);
    const s = await submitPayment(k, t, { amountBdt: "10000", method: "BKASH", reference: "FAKE1234", paidAt: PAID });
    await expect(rejectSubmission(cs, s.id, " ")).rejects.toThrow(/reason/);
    await rejectSubmission(cs, s.id, "No such transaction in our bKash statement");
    const r = await prisma.paymentSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect([r.status, r.paymentId, r.rejectReason]).toEqual(["REJECTED", null, "No such transaction in our bKash statement"]);
    expect(await prisma.payment.count()).toBe(0);
    // A rejected report no longer blocks the amount
    await submitPayment(k, t, { amountBdt: "10000", method: "BKASH", reference: "REAL1234", paidAt: PAID });
  });

  it("flags transaction IDs already used", async () => {
    const k = await customer("01711000000");
    const so = await invoicedShipping(k.customerId);
    await recordShippingPayment(cs, so.id, { amountBdt: "1000", method: "BKASH", reference: "TRXDUP01" });
    const s = await submitPayment(k, { kind: "shipping", id: so.id }, { amountBdt: "1000", method: "BKASH", reference: "trxdup01", paidAt: PAID });
    expect(await duplicateReferences(s.reference, s.id)).toEqual({ payments: 1, submissions: 0 });
    expect(await duplicateReferences("UNIQUE99", s.id)).toEqual({ payments: 0, submissions: 0 });
  });

  it("an advance reported on an approved request releases it for purchase once approved", async () => {
    const k = await customer("01711000000");
    const { order } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }] });
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    const e = await saveQuotation(china, order.id, { shippingMethod: "AIR", shippingRatePerKgRmb: "40", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: lines[0].id, unitPriceRmb: "12.5", unitWeightKg: "0.3" }] });
    await submitQuotation(china, e.id);
    const el = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, el.map((l) => ({ lineId: l.id, sellingPriceBdt: "4500" })));
    await sendQuotationToCustomer(cs, e.id);
    const t = { kind: "order" as const, id: order.id };
    expect(await amountDue(k.customerId, t)).toBeNull(); // not approved yet
    await decidePortalQuotation(k.customerId, e.id, "APPROVE");
    expect((await amountDue(k.customerId, t))?.due.toString()).toBe("4500");

    const s = await submitPayment(k, t, { amountBdt: "2000", method: "BKASH", reference: "ADV12345", paidAt: PAID });
    await approveSubmission(cs, s.id);
    const p = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect([p.type, p.amountBdt.toString(), p.paidAt.toISOString()]).toEqual(["ADVANCE", "2000", PAID.toISOString()]);
    expect(await prisma.notification.count({ where: { type: "READY_TO_PURCHASE", userId: china.id } })).toBe(1);
  });

  it("payment screenshots are visible only to the customer who sent them", async () => {
    const k = await customer("01711000000");
    const other = await customer("01811000000", "B");
    const so = await invoicedShipping(k.customerId);
    const s = await submitPayment(k, { kind: "shipping", id: so.id }, { amountBdt: "100", method: "BKASH", reference: "TRX55555", paidAt: PAID });
    const att = await prisma.attachment.create({ data: { kind: "OTHER", storageKey: "k", fileName: "shot.png", mimeType: "image/png", sizeBytes: 1, uploadedByAccountId: k.accountId, paymentSubmissionId: s.id } });
    expect(await portalAttachment([k.customerId], att.id)).not.toBeNull();
    expect(await portalAttachment([other.customerId], att.id)).toBeNull();
  });
});

describe("Customer confirms receipt", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("out for delivery → customer confirms → delivered; later notes are appended", async () => {
    const k = await customer("01711000000");
    const other = await customer("01811000000", "B");
    const so = await invoicedShipping(k.customerId);
    await expect(confirmReceipt(k.customerId, "shipping", so.id, { problem: false })).rejects.toThrow(/out for delivery/);
    await recordShippingPayment(cs, so.id, { amountBdt: "10000", method: "CASH" });
    await dispatchShipping(cs, so.id, { courier: "PATHAO", trackingNo: "P1" });
    await expect(confirmReceipt(other.customerId, "shipping", so.id, { problem: false })).rejects.toThrow(/not found/);

    await confirmReceipt(k.customerId, "shipping", so.id, { note: "All good, thanks", problem: false });
    let s = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect([s.status, s.customerNote, s.customerReportedProblem, s.receiverName]).toEqual(["DELIVERED", "All good, thanks", false, "Customer (portal)"]);
    expect(s.customerConfirmedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { type: "CUSTOMER_CONFIRMED_RECEIPT", userId: cs.id } })).toBe(1);

    await expect(confirmReceipt(k.customerId, "shipping", so.id, { problem: true })).rejects.toThrow(/what is wrong/);
    await confirmReceipt(k.customerId, "shipping", so.id, { note: "One pair has a broken sole", problem: true });
    s = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(s.customerReportedProblem).toBe(true);
    expect(s.customerNote).toMatch(/^All good, thanks\n\[\d{4}-\d{2}-\d{2}\] One pair has a broken sole$/);
    expect(await prisma.notification.count({ where: { type: "CUSTOMER_PROBLEM_REPORTED", userId: admin.id } })).toBe(1);
  });

  it("a request out for delivery becomes delivered when the customer confirms", async () => {
    const k = await customer("01711000000");
    const { order } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }, { productName: "Shade", quantity: 1, links: [] }] });
    await expect(confirmReceipt(k.customerId, "order", order.id, { problem: false })).rejects.toThrow(/out for delivery/);
    // Simulate BD dispatch (module 8 will set this)
    await prisma.orderLine.updateMany({ where: { orderId: order.id }, data: { status: "OUT_FOR_DELIVERY" } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "OUT_FOR_DELIVERY" } });
    await confirmReceipt(k.customerId, "order", order.id, { note: "Received both", problem: false });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect(o.status).toBe("DELIVERED");
    expect(o.lines.every((l) => l.status === "DELIVERED")).toBe(true);
    expect(o.customerNote).toBe("Received both");
  });
});
