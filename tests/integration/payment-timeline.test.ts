import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { approveSubmission, rejectSubmission, submitPayment } from "@/server/payment-submissions";
import { createPortalRequest, recordPayment } from "@/server/requests";
import { portalOrder } from "@/server/portal";
import { getOrderView } from "@/server/order-view";
import { paymentSteps } from "@/lib/payment-timeline";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor;
const SENT = new Date("2026-10-05T00:00:00Z");
const BALANCE_SENT = new Date("2026-10-09T00:00:00Z");

describe("Payment sent / confirmed in the tracking timeline", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("customer submits, Admin / CS confirm: both dates for every payment, confirmer only for staff", async () => {
    const acc = await signUp({ name: "Karim", phone: "01711000000", password: "secret-pass-1", address: "Mirpur" });
    await approveAccount(cs, acc.id, "new");
    const k = { accountId: acc.id, customerId: (await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).customerId! };
    const { order } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] }, { accountId: k.accountId });
    await quoteAndApprove(order.id, "10", "1000");
    const t = { kind: "order" as const, id: order.id };

    // Advance: submitted → waiting in the timeline, no confirmation yet
    const adv = await submitPayment(k, t, { amountBdt: "400", method: "BKASH", reference: "TRXADV001", paidAt: SENT });
    let p = (await portalOrder(k.customerId, order.id))!;
    expect(paymentSteps(p.payments, p.paymentSubmissions)).toEqual([expect.objectContaining({ step: "SENT", at: SENT, dayOnly: true, waiting: true, type: null })]);

    // Admin confirms → confirmation date set automatically
    const before = new Date();
    await approveSubmission(admin, adv.id);
    // Balance: CS confirms; a rejected report never shows
    const bad = await submitPayment(k, t, { amountBdt: "50", method: "NAGAD", reference: "TRXBAD001", paidAt: BALANCE_SENT });
    await rejectSubmission(cs, bad.id, "Wrong number");
    const bal = await submitPayment(k, t, { amountBdt: "600", method: "NAGAD", reference: "TRXBAL001", paidAt: BALANCE_SENT });
    await approveSubmission(cs, bal.id);
    await recordPayment(cs, order.id, { type: "REFUND", amountBdt: "10", method: "CASH" }); // refunds stay out

    // Customer portal: both steps per payment, with amounts and type – never who confirmed
    p = (await portalOrder(k.customerId, order.id))!;
    const forCustomer = paymentSteps(p.payments, p.paymentSubmissions);
    expect(forCustomer.map((s) => [s.step, s.type, s.amountBdt.toString(), s.waiting])).toEqual([
      ["SENT", "ADVANCE", "400", false],
      ["SENT", "BALANCE", "600", false],
      ["CONFIRMED", "ADVANCE", "400", false],
      ["CONFIRMED", "BALANCE", "600", false],
    ]);
    expect(forCustomer.filter((s) => s.step === "SENT").map((s) => s.at)).toEqual([SENT, BALANCE_SENT]);
    for (const s of forCustomer.filter((s) => s.step === "CONFIRMED")) expect(s.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(forCustomer.every((s) => s.confirmedBy === null)).toBe(true);
    expect(JSON.stringify(p.payments)).not.toMatch(/ADMIN \d|CS \d|receivedBy/); // the query doesn't load staff names

    // Admin view: same steps, plus who confirmed each payment
    const v = (await getOrderView(order.id, { role: "ADMIN" }))!;
    const forStaff = paymentSteps(v.payments, v.paymentSubmissions).filter((s) => s.step === "CONFIRMED");
    const names = await prisma.user.findMany({ where: { id: { in: [admin.id, cs.id] } }, orderBy: { role: "asc" } });
    expect(forStaff.map((s) => [s.type, s.confirmedBy])).toEqual([
      ["ADVANCE", names.find((u) => u.role === "ADMIN")!.name],
      ["BALANCE", names.find((u) => u.role === "CS")!.name],
    ]);
  });
});
