import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  accountForSession,
  approveAccount,
  authenticate,
  createResetToken,
  createSession,
  endSession,
  rejectAccount,
  resetPassword,
  setAccountDisabled,
  signUp,
} from "@/server/portal-auth";
import { portalAttachment, portalDashboard, portalOrder, portalSample, portalShippingOrder } from "@/server/portal";
import { MAX_FILES_PER_UPLOAD, saveAttachments } from "@/lib/uploads";
import { createPortalRequest, createRequest } from "@/server/requests";
import { createPortalShippingOrder, updatePortalShippingTracking } from "@/server/shipping-orders";
import { decidePortalQuotation, saveQuotation, setSellingPrices, submitQuotation, sendQuotationToCustomer } from "@/server/estimates";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const PW = "secret-pass-1";

async function activeCustomer(phone: string, name = "Karim") {
  const acc = await signUp({ name, phone, password: PW, address: "Mirpur 10", district: "Dhaka" });
  await approveAccount(cs, acc.id, "new");
  return prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id }, include: { customer: true } });
}

describe("Customer portal – accounts and login", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("sign-up stays pending until approved; approval creates or links the customer", async () => {
    const acc = await signUp({ name: "Karim", phone: "+880 1711-000000", password: PW, address: "Mirpur 10" });
    expect(acc.phone).toBe("01711000000");
    expect(acc.status).toBe("PENDING");
    expect(acc.passwordHash).not.toContain(PW);
    expect(await prisma.notification.count({ where: { type: "PORTAL_SIGNUP", userId: cs.id } })).toBe(1);

    // Right password, but pending → no login
    const pending = await authenticate("01711000000", PW);
    expect(pending).toEqual({ ok: false, error: expect.stringMatching(/waiting for approval/) });
    // Same phone can't sign up twice
    await expect(signUp({ name: "X", phone: "01711000000", password: PW, address: "x" })).rejects.toThrow(/already exists/);

    await expect(approveAccount(china, acc.id, "new")).rejects.toThrow(ForbiddenError);
    await approveAccount(cs, acc.id, "new");
    const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id }, include: { customer: true } });
    expect(a.status).toBe("ACTIVE");
    expect(a.customer?.name).toBe("Karim");
    expect(await authenticate("8801711000000", PW)).toEqual({ ok: true, accountId: acc.id });

    // A second sign-up with an existing customer's phone links to that customer instead of creating a duplicate
    const { order } = await createRequest(cs, { customer: { name: "Old", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "a", quantity: 1, links: [] }] });
    const acc2 = await signUp({ name: "Old", phone: "01811000000", password: PW, address: "x" });
    await expect(approveAccount(cs, acc2.id, "new")).rejects.toThrow(/already exists/);
    await approveAccount(cs, acc2.id, order.customerId);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc2.id } })).customerId).toBe(order.customerId);
  });

  it("rejects bad phone numbers and short passwords", async () => {
    await expect(signUp({ name: "a", phone: "12345", password: PW, address: "x" })).rejects.toThrow(/mobile number/);
    await expect(signUp({ name: "a", phone: "01711000000", password: "short", address: "x" })).rejects.toThrow(/at least 8/);
  });

  it("rejected sign-ups can't log in, but may sign up again", async () => {
    const acc = await signUp({ name: "Spam", phone: "01911000000", password: PW, address: "x" });
    await rejectAccount(cs, acc.id, "Could not verify");
    expect(await authenticate("01911000000", PW)).toEqual({ ok: false, error: expect.stringMatching(/Could not verify/) });
    const again = await signUp({ name: "Real", phone: "01911000000", password: PW, address: "y" });
    expect(again.id).toBe(acc.id);
    expect(again.status).toBe("PENDING");
  });

  it("locks the account after repeated wrong passwords and gives the same error for unknown phones", async () => {
    await activeCustomer("01711000000");
    const unknown = await authenticate("01799999999", "whatever");
    const wrong = await authenticate("01711000000", "wrong-password");
    expect(unknown).toEqual(wrong); // can't tell which phones have accounts
    for (let i = 1; i < MAX_FAILED_LOGINS - 1; i++) await authenticate("01711000000", "wrong-password");
    expect(await authenticate("01711000000", "wrong-password")).toEqual({ ok: false, error: expect.stringMatching(/Too many/) });
    // Locked even with the right password…
    expect((await authenticate("01711000000", PW)).ok).toBe(false);
    // …until the lock expires
    const later = new Date(Date.now() + (LOCK_MINUTES + 1) * 60_000);
    expect((await authenticate("01711000000", PW, later)).ok).toBe(true);
  });

  it("sessions are hashed, expire, end on logout and on disable", async () => {
    const acc = await activeCustomer("01711000000");
    const { token } = await createSession(acc.id);
    expect(await prisma.portalSession.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored
    expect((await accountForSession(token))?.customer?.id).toBe(acc.customerId);
    expect(await accountForSession("forged-token")).toBeNull();
    expect(await accountForSession(token, new Date(Date.now() + 31 * 86_400_000))).toBeNull();

    await endSession(token);
    expect(await accountForSession(token)).toBeNull();

    const s2 = await createSession(acc.id);
    await setAccountDisabled(cs, acc.id, true);
    expect(await accountForSession(s2.token)).toBeNull();
    expect((await authenticate("01711000000", PW)).ok).toBe(false);
    await setAccountDisabled(cs, acc.id, false);
    expect((await authenticate("01711000000", PW)).ok).toBe(true);
  });

  it("reset links work once, only the newest is valid, and they sign out other sessions", async () => {
    const acc = await activeCustomer("01711000000");
    const old = await createSession(acc.id);
    await expect(createResetToken(china, acc.id)).rejects.toThrow(ForbiddenError);
    const t1 = await createResetToken(cs, acc.id);
    const t2 = await createResetToken(cs, acc.id);
    await expect(resetPassword(t1, "new-password-1")).rejects.toThrow(/expired or was already used/);
    await resetPassword(t2, "new-password-1");
    await expect(resetPassword(t2, "new-password-2")).rejects.toThrow(/already used/);
    expect(await accountForSession(old.token)).toBeNull();
    expect((await authenticate("01711000000", PW)).ok).toBe(false);
    expect((await authenticate("01711000000", "new-password-1")).ok).toBe(true);
    const t3 = await createResetToken(cs, acc.id);
    await expect(resetPassword(t3, "x", new Date(Date.now() + 25 * 3_600_000))).rejects.toThrow();
  });
});

describe("Customer portal – data", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("customers submit requests and shipping orders that staff see as from the portal", async () => {
    const a = await activeCustomer("01711000000");
    const { order } = await createPortalRequest(a.customerId!, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 3, links: ["https://detail.1688.com/offer/1.html"] }] });
    expect(order.customerId).toBe(a.customerId);
    expect(order.source).toBe("PORTAL");
    expect(order.createdById).toBeNull();
    expect(await prisma.notification.count({ where: { type: "PORTAL_REQUEST", userId: cs.id } })).toBe(1);
    // Staff carry on as usual

    const so = await createPortalShippingOrder(a.customerId!, { shippingMethod: "SEA", qaRequested: true, items: [{ productName: "Chairs", quantity: 10 }] });
    expect(so.source).toBe("PORTAL");
    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    await updatePortalShippingTracking(a.customerId!, so.id, [{ itemId: item.id, courierName: "SF", trackingNo: "SF1" }]);
    expect((await prisma.shippingOrderItem.findUniqueOrThrow({ where: { id: item.id } })).trackingNo).toBe("SF1");

    const d = await portalDashboard(a.customerId!);
    expect(d.orders.map((o) => o.id)).toEqual([order.id]);
    expect(d.shipping.map((s) => s.id)).toEqual([so.id]);
  });

  it("one customer can never read or change another customer's records", async () => {
    const a = await activeCustomer("01711000000", "A");
    const b = await activeCustomer("01811000000", "B");
    const { order } = await createPortalRequest(a.customerId!, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] });
    const so = await createPortalShippingOrder(a.customerId!, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "x", quantity: 1 }] });
    const smp = await prisma.sample.create({ data: { customerId: a.customerId!, requestedById: cs.id } });

    expect(await portalOrder(b.customerId!, order.id)).toBeNull();
    expect(await portalShippingOrder(b.customerId!, so.id)).toBeNull();
    expect(await portalSample(b.customerId!, smp.id)).toBeNull();
    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    await expect(updatePortalShippingTracking(b.customerId!, so.id, [{ itemId: item.id, trackingNo: "HACK" }])).rejects.toThrow(/not found/);
    const dB = await portalDashboard(b.customerId!);
    expect([dB.orders.length, dB.shipping.length, dB.samples.length]).toEqual([0, 0, 0]);
  });

  it("shows only the quote sent to the customer, in BDT – never RMB cost, rate or margin", async () => {
    const a = await activeCustomer("01711000000");
    const { order } = await createPortalRequest(a.customerId!, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }] });
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    const e = await saveQuotation(china, order.id, { shippingMethod: "AIR", shippingRatePerKgRmb: "40", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: lines[0].id, unitPriceRmb: "12.5", unitWeightKg: "0.3" }] });
    await submitQuotation(china, e.id);
    // Submitted but not sent → not visible
    expect((await portalOrder(a.customerId!, order.id))?.quote).toBeNull();
    const el = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, el.map((l) => ({ lineId: l.id, sellingPriceBdt: "4500" })));
    await sendQuotationToCustomer(cs, e.id);

    const view = await portalOrder(a.customerId!, order.id);
    expect(view?.quote?.grandTotalBdt?.toString()).toBe("4500");
    const json = JSON.stringify(view);
    for (const secret of ["unitPriceRmb", "totalRmb", "rateUsed", "marginBdt", "rmbSubtotal", "createdBy", "comments", "specialInstructions"]) expect(json).not.toContain(secret);
  });
});

describe("Customer portal – files, quote approval", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  async function sentQuote(customerId: string, validUntil = new Date("2099-01-01T00:00:00Z")) {
    const { order } = await createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }] });
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    const e = await saveQuotation(china, order.id, { shippingMethod: "AIR", shippingRatePerKgRmb: "40", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: lines[0].id, unitPriceRmb: "12.5", unitWeightKg: "0.3" }] });
    await submitQuotation(china, e.id);
    const el = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, el.map((l) => ({ lineId: l.id, sellingPriceBdt: "4500" })));
    await sendQuotationToCustomer(cs, e.id);
    if (validUntil) await prisma.estimate.update({ where: { id: e.id }, data: { validUntil } });
    return { order, estimateId: e.id };
  }

  it("the customer approves their own quote: request approved, in the purchase queue, staff notified", async () => {
    const a = await activeCustomer("01711000000");
    const b = await activeCustomer("01811000000", "B");
    const { order, estimateId } = await sentQuote(a.customerId!);
    await expect(decidePortalQuotation(b.customerId!, estimateId, "APPROVE")).rejects.toThrow(/not found/);
    await decidePortalQuotation(a.customerId!, estimateId, "APPROVE");
    const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
    expect([e.status, e.decidedInPortal]).toEqual(["APPROVED", true]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect(o.requestStatus).toBe("CUSTOMER_APPROVED");
    expect(o.lines.every((l) => l.status === "APPROVED")).toBe(true);
    expect(await prisma.notification.count({ where: { type: "PORTAL_QUOTE_APPROVED", userId: cs.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "APPROVED_FOR_PURCHASE", userId: china.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Estimate", entityId: estimateId, field: "status", newValue: { equals: "APPROVED" } } });
    expect(audit?.userId).toBeNull(); // done by the customer, not staff
    await expect(decidePortalQuotation(a.customerId!, estimateId, "DECLINE")).rejects.toThrow(/already answered/);
  });

  it("declining closes the request; expired quotes can't be approved", async () => {
    const a = await activeCustomer("01711000000");
    const q1 = await sentQuote(a.customerId!);
    await decidePortalQuotation(a.customerId!, q1.estimateId, "DECLINE", "Too expensive");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: q1.order.id } })).requestStatus).toBe("REJECTED");
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: q1.estimateId } })).notes).toMatch(/Too expensive/);

    const q2 = await sentQuote(a.customerId!, new Date("2020-01-01T00:00:00Z"));
    await expect(decidePortalQuotation(a.customerId!, q2.estimateId, "APPROVE")).rejects.toThrow(/expired/);
  });

  it("customers can fetch their own files and staff photos on their orders, never others' or supplier invoices", async () => {
    const a = await activeCustomer("01711000000");
    const b = await activeCustomer("01811000000", "B");
    const so = await createPortalShippingOrder(a.customerId!, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "x", quantity: 1 }] });
    const base = { storageKey: "k", fileName: "f.jpg", mimeType: "image/jpeg", sizeBytes: 1 };
    const own = await prisma.attachment.create({ data: { ...base, kind: "PRODUCT_IMAGE", uploadedByAccountId: a.id, shippingOrderId: so.id } });
    const qa = await prisma.attachment.create({ data: { ...base, kind: "QA_PHOTO", uploadedById: china.id, shippingOrderId: so.id } });
    const supplierInvoice = await prisma.attachment.create({ data: { ...base, kind: "SUPPLIER_INVOICE", uploadedById: china.id, shippingOrderId: so.id } });
    const { order } = await createPortalRequest(a.customerId!, { shippingMethod: "AIR", lines: [{ productName: "L", quantity: 1, links: [] }] });
    const c = await prisma.comment.create({ data: { orderId: order.id, authorId: cs.id, body: "internal" } });
    const commentFile = await prisma.attachment.create({ data: { ...base, kind: "OTHER", uploadedById: cs.id, orderId: order.id, commentId: c.id } });

    expect(await portalAttachment([a.customerId!], own.id)).not.toBeNull();
    expect(await portalAttachment([a.customerId!], qa.id)).not.toBeNull();
    expect(await portalAttachment([a.customerId!], supplierInvoice.id)).toBeNull();
    expect(await portalAttachment([a.customerId!], commentFile.id)).toBeNull();
    expect(await portalAttachment([b.customerId!], own.id)).toBeNull();
    const view = await portalShippingOrder(a.customerId!, so.id);
    expect(view?.attachments.map((x) => x.id).sort()).toEqual([own.id, qa.id].sort());
  });

  it("portal uploads are limited and recorded against the customer account", async () => {
    const a = await activeCustomer("01711000000");
    const so = await createPortalShippingOrder(a.customerId!, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "x", quantity: 1 }] });
    const img = () => new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" });
    await expect(saveAttachments(Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, img), "PRODUCT_IMAGE", { accountId: a.id }, { shippingOrderId: so.id })).rejects.toThrow(/at most/);
    await expect(saveAttachments([new File(["x"], "a.exe", { type: "application/x-msdownload" })], "OTHER", { accountId: a.id }, { shippingOrderId: so.id })).rejects.toThrow(/only images and PDF/);
    await saveAttachments([img()], "PRODUCT_IMAGE", { accountId: a.id }, { shippingOrderId: so.id });
    const att = await prisma.attachment.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    expect([att.uploadedById, att.uploadedByAccountId]).toEqual([null, a.id]);
  });
});
