import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { chinaInbox, createRequest, recordPayment } from "@/server/requests";
import { createPurchase, decidePriceChange, markProblem, markPurchased, markShippedBySupplier, purchaseQueue, requestUpfrontPayment } from "@/server/purchasing";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

async function approvedOrder(qty = 4, quote = "10.00", advance = true) {
  const { order } = await createRequest(cs, {
    customer: { name: "A", phone: "01700000001", address: "x" },
    shippingMethod: "AIR",
    lines: [
      { productName: "Lamp", quantity: qty, links: [] },
      { productName: "Bulb", quantity: 10, links: [] },
    ],
  });
  await quoteAndApprove(order.id, quote, "1000");
  if (advance) await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "500", method: "CASH" });
  return order;
}

describe("China purchasing", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("approved orders appear in the queue at once; buying waits for BD payment confirmation", async () => {
    const o = await approvedOrder(4, "10", false);
    let q = await purchaseQueue();
    expect(q.map((l) => [l.order.id, l.advancePaid])).toEqual([
      [o.id, false],
      [o.id, false],
    ]);
    const buy = () => createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 1, unitPriceRmb: "10" }] });
    await expect(buy()).rejects.toThrow(/upfront payment not confirmed/);

    // China requests upfront payment → BD notified
    await expect(requestUpfrontPayment(cs, o.id)).rejects.toThrow(ForbiddenError);
    await requestUpfrontPayment(china, o.id, "50% please");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).advanceRequestNote).toBe("50% please");
    expect(await prisma.notification.count({ where: { type: "UPFRONT_PAYMENT_REQUESTED", userId: cs.id } })).toBe(1);
    expect((await chinaInbox()).awaitingAdvance.map((x) => x.id)).toEqual([o.id]);

    // BD confirms by recording the advance → China notified, buying allowed
    await recordPayment(cs, o.id, { type: "ADVANCE", amountBdt: "500", method: "BKASH" });
    expect(await prisma.notification.count({ where: { type: "READY_TO_PURCHASE", userId: china.id } })).toBe(1);
    expect((await chinaInbox()).awaitingAdvance).toHaveLength(0);
    q = await purchaseQueue();
    expect(q.every((l) => l.advancePaid)).toBe(true);
    await expect(requestUpfrontPayment(china, o.id)).rejects.toThrow(/already confirmed/);
    await expect(buy()).resolves.toBeTruthy();
  });

  it("purchase complete requires the order tracking URL and estimated receive date", async () => {
    const o = await approvedOrder();
    const base = { supplierName: "S", platform: "TAOBAO" as const, lines: [{ orderLineId: o.lines[0].id, quantity: 1, unitPriceRmb: "10" }] };
    await expect(createPurchase(china, { ...base, trackingUrl: "", expectedArrivalAt: DONE.expectedArrivalAt })).rejects.toThrow(/tracking URL/);
    await expect(createPurchase(china, { ...base, trackingUrl: "trade.1688.com/x", expectedArrivalAt: DONE.expectedArrivalAt })).rejects.toThrow(/http/);
    const so = await createPurchase(china, { ...base, ...DONE });
    expect(so.trackingUrl).toBe(DONE.trackingUrl);
    expect(so.expectedArrivalAt?.toISOString()).toBe(DONE.expectedArrivalAt.toISOString());
  });

  it("CS cannot record purchases", async () => {
    const o = await approvedOrder();
    await expect(
      createPurchase(cs, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 1, unitPriceRmb: "1" }] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("splits shipping and service charge by value and locks the rate", async () => {
    const o = await approvedOrder();
    const so = await createPurchase(china, { ...DONE,
      supplierName: "Shop A",
      platform: "ALIBABA_1688",
      domesticShippingRmb: "10",
      serviceChargeRmb: "5",
      lines: [
        { orderLineId: o.lines[0].id, quantity: 4, unitPriceRmb: "10.00" }, // 40
        { orderLineId: o.lines[1].id, quantity: 10, unitPriceRmb: "2.00" }, // 20
      ],
    });
    expect(so.status).toBe("PURCHASED");
    expect(so.totalRmb.toString()).toBe("75");
    expect(so.totalBdt.toString()).toBe("1275");
    const lines = await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id }, orderBy: { productTotalRmb: "desc" } });
    expect(lines.map((l) => [l.domesticShippingShareRmb.toString(), l.serviceChargeShareRmb.toString(), l.totalRmb.toString(), l.totalBdt.toString()])).toEqual([
      ["6.67", "3.34", "50.01", "850.17"],
      ["3.33", "1.66", "24.99", "424.83"],
    ]);
    const ol = await prisma.orderLine.findMany({ where: { orderId: o.id } });
    expect(ol.every((l) => l.status === "PURCHASED")).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PURCHASED");
    expect(await purchaseQueue()).toHaveLength(0);
  });

  it("keeps a partly bought line in the queue and blocks over-buying", async () => {
    const o = await approvedOrder();
    await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 3, unitPriceRmb: "10" }] });
    const q = await purchaseQueue();
    expect(q.find((l) => l.id === o.lines[0].id)?.remaining).toBe(1);
    await expect(
      createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 2, unitPriceRmb: "10" }] }),
    ).rejects.toThrow(/Only 1/);
  });

  it("flags a price above the alert % for BD approval before buying", async () => {
    const o = await approvedOrder();
    const so = await createPurchase(china, { ...DONE,
      supplierName: "S",
      platform: "TAOBAO",
      lines: [{ orderLineId: o.lines[0].id, quantity: 4, unitPriceRmb: "11.00" }], // +10% > 5%
    });
    expect(so.status).toBe("PENDING");
    const pl = await prisma.purchaseLine.findFirstOrThrow({ where: { supplierOrderId: so.id } });
    expect(pl.priceApproval).toBe("PENDING");
    expect(pl.priceChangePct?.toString()).toBe("10");
    expect(await prisma.notification.count({ where: { type: "PRICE_APPROVAL_NEEDED" } })).toBeGreaterThan(0);

    await expect(markPurchased(china, so.id)).rejects.toThrow(/approval/);
    await expect(decidePriceChange(china, pl.id, true)).rejects.toThrow(ForbiddenError);
    await decidePriceChange(cs, pl.id, true);
    await markPurchased(china, so.id);
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: o.lines[0].id } })).status).toBe("PURCHASED");
  });

  it("records supplier shipping on the timeline", async () => {
    const o = await approvedOrder();
    const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 4, unitPriceRmb: "10" }] });
    await markShippedBySupplier(china, so.id, { courierName: "ZTO", trackingNo: " 7788 " });
    const updated = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(updated.status).toBe("SHIPPED_BY_SUPPLIER");
    expect(updated.trackingNo).toBe("7788");
    expect(await prisma.trackingEvent.count({ where: { trackingNo: "7788" } })).toBe(1);
  });

  it("out of stock sends lines back to the queue", async () => {
    const o = await approvedOrder();
    const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: [{ orderLineId: o.lines[0].id, quantity: 4, unitPriceRmb: "10" }] });
    await markProblem(china, so.id, "OUT_OF_STOCK", "sold out");
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: o.lines[0].id } })).status).toBe("APPROVED");
    expect((await purchaseQueue()).find((l) => l.id === o.lines[0].id)?.remaining).toBe(4);
  });
});
