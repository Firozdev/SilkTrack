import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createRequest, recordPayment, sendToChina } from "@/server/requests";
import { createPurchase, requestUpfrontPayment } from "@/server/purchasing";
import { bdDashboard, chinaDashboard, managementDashboard, ordersByStatus } from "@/server/dashboard";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

async function approved(phone: string, selling = "1000") {
  const { order } = await createRequest(cs, { customer: { name: "C", phone, address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Item", quantity: 2, links: [] }] });
  await quoteAndApprove(order.id, "10", selling);
  return order;
}

describe("dashboards", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("counts the pipeline for BD and China", async () => {
    const { order: fresh } = await createRequest(cs, { customer: { name: "N", phone: "0100", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "A", quantity: 1, links: [] }] });
    const sent = (await createRequest(cs, { customer: { name: "S", phone: "0101", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "B", quantity: 1, links: [] }] })).order;
    await sendToChina(cs, sent.id);
    const a = await approved("0102");
    const b = await approved("0103");
    await requestUpfrontPayment(china, a.id);
    await recordPayment(cs, b.id, { type: "ADVANCE", amountBdt: "500", method: "CASH" });

    const bd = await bdDashboard();
    expect(bd).toMatchObject({ newRequests: 1, sentToChina: 1, quotationsToReview: 0, quoted: 0, upfrontRequested: 1 });
    const cn = await chinaDashboard();
    expect(cn).toMatchObject({ toPrice: 1, readyToBuy: 1, needPaymentRequest: 0, waitingForPayment: 1 });

    const rows = await ordersByStatus();
    expect(rows.find((r) => r.status === "REQUESTED")?.count).toBe(2);
    expect(rows.find((r) => r.status === "APPROVED")?.count).toBe(2);
    expect(fresh).toBeTruthy();
  });

  it("estimates revenue and profit from selling price, purchase cost and freight", async () => {
    const o = await approved("0200", "1000");
    await recordPayment(cs, o.id, { type: "ADVANCE", amountBdt: "500", method: "CASH" });
    // 2 × ¥10 + ¥5 shipping = ¥25 × 17 = ৳425
    await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", domesticShippingRmb: "5", lines: [{ orderLineId: o.lines[0].id, quantity: 2, unitPriceRmb: "10" }] });
    await approved("0201", "300"); // approved, not bought

    const m = await managementDashboard();
    expect(m.month.orders).toBe(2);
    expect(m.month.revenue.toString()).toBe("1300");
    expect(m.month.profit.toString()).toBe("575");
    const row = m.recentOrders.find((r) => r.id === o.id)!;
    expect([row.revenue.toString(), row.chinaCost.toString(), row.profit?.toString()]).toEqual(["1000", "425", "575"]);
    expect(m.recentOrders.find((r) => r.id !== o.id)?.profit).toBeNull();
    expect(m.leadTimes.approvalToPurchase).not.toBeNull();
  });

  it("balance to collect = issued invoices minus payments", async () => {
    const o = await approved("0300");
    const rate = await prisma.exchangeRate.findFirstOrThrow();
    await recordPayment(cs, o.id, { type: "ADVANCE", amountBdt: "400", method: "CASH" });
    await prisma.invoice.create({
      data: { orderId: o.id, status: "ISSUED", exchangeRateId: rate.id, rateUsed: rate.rate, productCostRmb: "20", productCostBdt: "1000", totalBdt: "1150", advancePaidBdt: "400", balanceDueBdt: "750", issuedAt: new Date() },
    });
    expect((await bdDashboard()).balanceToCollect.toString()).toBe("750");
  });
});
