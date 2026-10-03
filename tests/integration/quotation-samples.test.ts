import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createRequest, sendToChina } from "@/server/requests";
import { approveQuotation, reviseQuotation, saveQuotation, sendQuotationToCustomer, setSellingPrices, submitQuotation, type QuotationInput } from "@/server/estimates";
import { cancelSample, deliverSample, invoiceSample, purchaseSample, receiveSampleBd, recordSamplePayment, requestSample, shipSample } from "@/server/samples";
import { purchaseQueue } from "@/server/purchasing";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor, chinaSeller: Actor;
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function sentRequest() {
  const { order } = await createRequest(cs, {
    customer: { name: "Q", phone: "01500000000", address: "x" },
    shippingMethod: "AIR",
    lines: [
      { productName: "Lamp", quantity: 10, links: [] },
      { productName: "Shade", quantity: 4, links: [] },
    ],
  });
  await sendToChina(cs, order.id);
  return order;
}

const quote = (order: Awaited<ReturnType<typeof sentRequest>>, over: Partial<QuotationInput> = {}): QuotationInput => ({
  shippingMethod: "AIR",
  shippingRatePerKgRmb: "40",
  domesticShippingRmb: "15",
  serviceFeeRmb: "10",
  validUntil: FUTURE,
  lines: [
    { orderLineId: order.lines[0].id, unitPriceRmb: "12.50", unitWeightKg: "0.35", cartonCount: 1, lengthCm: "50", widthCm: "40", heightCm: "30" },
    { orderLineId: order.lines[1].id, unitPriceRmb: "30", unitWeightKg: "1.2", cartonCount: 2, lengthCm: "20", widthCm: "20", heightCm: "20" },
  ],
  ...over,
});

describe("China quotation", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    chinaSeller = { ...(await makeUser("PURCHASE")), canSetSellingPrice: true };
    await prisma.user.update({ where: { id: chinaSeller.id }, data: { canSetSellingPrice: true } });
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("China quotes weight, CBM, shipping and totals at the locked rate", async () => {
    const order = await sentRequest();
    await expect(saveQuotation(cs, order.id, quote(order))).rejects.toThrow(ForbiddenError);
    const e = await saveQuotation(china, order.id, quote(order));
    expect([e.rmbSubtotal, e.grossWeightKg, e.cbm, e.shippingRmb, e.totalRmb, e.totalBdt, e.rateUsed].map(String)).toEqual(["245", "8.3", "0.076", "332", "602", "10384.5", "17.25"]);
    expect(e.cartonCount).toBe(3);
    expect(e.grandTotalBdt).toBeNull();
    // saving again updates the same draft
    const again = await saveQuotation(china, order.id, quote(order, { shippingRatePerKgRmb: "50" }));
    expect(again.id).toBe(e.id);
    expect(again.shippingRmb.toString()).toBe("415");
    await expect(saveQuotation(china, order.id, quote(order, { lines: quote(order).lines.slice(0, 1) }))).rejects.toThrow(/Shade/);
  });

  it("ignores selling prices from China users without permission, accepts them with it", async () => {
    const order = await sentRequest();
    const withSelling = quote(order, { lines: quote(order).lines.map((l) => ({ ...l, sellingPriceBdt: "6000" })) });
    const e1 = await saveQuotation(china, order.id, withSelling);
    expect((await prisma.estimateLine.findMany({ where: { estimateId: e1.id } })).every((l) => l.sellingPriceBdt === null)).toBe(true);
    await expect(setSellingPrices(china, e1.id, [])).rejects.toThrow(ForbiddenError);

    const e2 = await saveQuotation(chinaSeller, order.id, withSelling);
    expect(e2.grandTotalBdt?.toString()).toBe("12000");
    expect(e2.marginBdt?.toString()).toBe("1615.5"); // 12000 − 10384.5
  });

  it("BD prices and sends, approval puts it in the purchase queue; expired needs re-pricing", async () => {
    const order = await sentRequest();
    const e = await saveQuotation(china, order.id, quote(order));
    await expect(sendQuotationToCustomer(cs, e.id)).rejects.toThrow(/submitted/);
    await submitQuotation(china, e.id);
    expect(await prisma.notification.count({ where: { type: "ESTIMATE_READY", userId: cs.id } })).toBe(1);
    await expect(sendQuotationToCustomer(cs, e.id)).rejects.toThrow(/selling price/);
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, lines.map((l) => ({ lineId: l.id, sellingPriceBdt: "7000" })));
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("REVIEWED_BY_BD");
    await sendQuotationToCustomer(cs, e.id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(o.requestStatus).toBe("QUOTED");
    expect(o.lines.map((l) => [l.quotedUnitPriceRmb?.toString(), l.sellingPriceBdt?.toString()])).toEqual([
      ["12.5", "7000"],
      ["30", "7000"],
    ]);

    await prisma.estimate.update({ where: { id: e.id }, data: { validUntil: new Date("2020-01-01T00:00:00Z") } });
    await expect(approveQuotation(cs, e.id)).rejects.toThrow(/expired/);
    await prisma.estimate.update({ where: { id: e.id }, data: { validUntil: FUTURE } });
    await approveQuotation(cs, e.id);
    expect((await purchaseQueue()).map((l) => l.order.id)).toContain(order.id);
  });

  it("revision creates v2 draft and returns the request to China", async () => {
    const order = await sentRequest();
    const e = await saveQuotation(china, order.id, quote(order));
    await submitQuotation(china, e.id);
    const v2 = await reviseQuotation(cs, e.id, "customer wants sea");
    expect(v2.version).toBe(2);
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("REVISED");
    expect(await prisma.estimateLine.count({ where: { estimateId: v2.id } })).toBe(2);
    const updated = await saveQuotation(china, order.id, quote(order, { shippingMethod: "SEA", shippingRatePerCbmRmb: "1500" }));
    expect(updated.id).toBe(v2.id);
    expect(updated.shippingRmb.toString()).toBe("114");
    await expect(reviseQuotation(cs, e.id)).rejects.toThrow(/can't be revised|newer/);
  });
});

describe("samples", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  async function quoted() {
    const order = await sentRequest();
    const e = await saveQuotation(china, order.id, quote(order));
    return { order, e };
  }

  it("needs a submitted quotation; payment-required samples wait for BD", async () => {
    const { order, e } = await quoted();
    const lines = [{ orderLineId: order.lines[0].id, quantity: 1 }];
    await expect(requestSample(cs, order.id, { lines })).rejects.toThrow(/quotation/);
    await submitQuotation(china, e.id);
    await expect(requestSample(china, order.id, { lines })).rejects.toThrow(ForbiddenError);
    const s = await requestSample(cs, order.id, { lines, note: "check colour" });
    expect(await prisma.notification.count({ where: { type: "SAMPLE_REQUESTED", userId: china.id } })).toBe(1);

    await invoiceSample(china, s.id, { productRmb: "25", shippingToBdRmb: "60", paymentRequired: true });
    let x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.status, x.totalRmb?.toString(), x.totalBdt?.toString()]).toEqual(["AWAITING_PAYMENT", "85", "1445"]);
    const buy = () => purchaseSample(china, s.id, { supplierName: "Shop", purchaseTrackingUrl: "https://t.example/1", expectedAtWarehouseAt: FUTURE });
    await expect(buy()).rejects.toThrow(/Waiting for the BD team/);

    await recordSamplePayment(cs, s.id, { amountBdt: "1445", method: "BKASH" });
    expect((await prisma.payment.findFirstOrThrow({ where: { sampleId: s.id } })).type).toBe("SAMPLE");
    await buy();
    await expect(shipSample(china, s.id, { shippingMode: "EXPRESS_COURIER" })).rejects.toThrow(/tracking/);
    await shipSample(china, s.id, { shippingMode: "EXPRESS_COURIER", carrierName: "DHL", trackingNo: "DHL123", etaBd: FUTURE });
    await receiveSampleBd(cs, s.id);
    await deliverSample(cs, s.id, "Colour OK");
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.status, x.customerFeedback, x.trackingNo]).toEqual(["DELIVERED", "Colour OK", "DHL123"]);
    const events = await prisma.sampleEvent.findMany({ where: { sampleId: s.id }, orderBy: { occurredAt: "asc" } });
    expect(events.map((ev) => ev.status).filter(Boolean)).toEqual(["REQUESTED", "AWAITING_PAYMENT", "PAID", "PURCHASED", "SHIPPED", "RECEIVED_BD", "DELIVERED"]);
  });

  it("China can buy without payment and send by hand carry", async () => {
    const { order, e } = await quoted();
    await submitQuotation(china, e.id);
    const s = await requestSample(cs, order.id, { lines: [{ orderLineId: order.lines[1].id, quantity: 2 }] });
    await invoiceSample(china, s.id, { productRmb: "60", paymentRequired: false });
    await purchaseSample(china, s.id, { supplierName: "Shop", purchaseTrackingUrl: "https://t.example/2", expectedAtWarehouseAt: FUTURE });
    await shipSample(china, s.id, { shippingMode: "HAND_CARRY", carrierName: "Mr. Li (flight BS-322)" });
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("SHIPPED");
    await cancelSample(cs, s.id, "customer cancelled");
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANCELLED");
  });
});

describe("request status while sampling", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).requestStatus;

  it("moves to Sampling and back to Sent to China when the last sample closes", async () => {
    const order = await sentRequest();
    const e = await saveQuotation(china, order.id, quote(order));
    await submitQuotation(china, e.id);
    const a = await requestSample(cs, order.id, { lines: [{ orderLineId: order.lines[0].id, quantity: 1 }] });
    const b = await requestSample(cs, order.id, { lines: [{ orderLineId: order.lines[1].id, quantity: 1 }] });
    expect(await status(order.id)).toBe("SAMPLING");
    await cancelSample(cs, a.id, "not needed");
    expect(await status(order.id)).toBe("SAMPLING"); // b still open
    await cancelSample(cs, b.id, "not needed");
    expect(await status(order.id)).toBe("SENT_TO_CHINA");
    const log = await prisma.auditLog.findMany({ where: { entityId: order.id, field: "requestStatus" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.newValue)).toEqual(["SENT_TO_CHINA", "SAMPLING", "SENT_TO_CHINA"]);
  });

  it("returns to Quoted after delivery when the quotation was sent; approval works during sampling", async () => {
    const order = await sentRequest();
    const e = await saveQuotation(china, order.id, quote(order));
    await submitQuotation(china, e.id);
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, lines.map((l) => ({ lineId: l.id, sellingPriceBdt: "5000" })));
    await sendQuotationToCustomer(cs, e.id);
    const s = await requestSample(cs, order.id, { lines: [{ orderLineId: order.lines[0].id, quantity: 1 }] });
    expect(await status(order.id)).toBe("SAMPLING");
    await invoiceSample(china, s.id, { productRmb: "10", paymentRequired: false });
    await purchaseSample(china, s.id, { supplierName: "S", purchaseTrackingUrl: "https://x.example", expectedAtWarehouseAt: FUTURE });
    await shipSample(china, s.id, { shippingMode: "POST" });
    await receiveSampleBd(cs, s.id);
    await deliverSample(cs, s.id, "good");
    expect(await status(order.id)).toBe("QUOTED");

    // a second sample, then approval while still sampling
    await requestSample(cs, order.id, { lines: [{ orderLineId: order.lines[1].id, quantity: 1 }] });
    expect(await status(order.id)).toBe("SAMPLING");
    await approveQuotation(cs, e.id);
    expect(await status(order.id)).toBe("CUSTOMER_APPROVED");
  });
});

describe("stand-alone samples", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("creates a sample without a request and runs it to delivery with payment", async () => {
    const { createStandaloneSample } = await import("@/server/samples");
    const { customerLedger } = await import("@/server/ledger");
    await expect(createStandaloneSample(china, { customer: { name: "X", phone: "0190", address: "y" }, lines: [{ productName: "Bag", quantity: 1 }] })).rejects.toThrow(ForbiddenError);
    const s = await createStandaloneSample(cs, {
      customer: { name: "Nadia", phone: "01900-111222", address: "Gulshan 2" },
      lines: [{ productName: "Leather bag", variant: "brown", link: "https://detail.1688.com/offer/1.html", quantity: 2 }],
      note: "check stitching",
    });
    const row = await prisma.sample.findUniqueOrThrow({ where: { id: s.id }, include: { customer: true, lines: true } });
    expect([row.orderId, row.customer.code, row.lines[0].productName, row.lines[0].variant]).toEqual([null, "C-00001", "Leather bag", "brown"]);
    expect(await prisma.notification.count({ where: { type: "SAMPLE_REQUESTED", userId: china.id } })).toBe(1);

    await invoiceSample(china, s.id, { productRmb: "50", paymentRequired: true });
    await recordSamplePayment(cs, s.id, { amountBdt: "850", method: "NAGAD" });
    expect((await prisma.payment.findFirstOrThrow({ where: { sampleId: s.id } })).orderId).toBeNull();
    await purchaseSample(china, s.id, { supplierName: "S", purchaseTrackingUrl: "https://x.example", expectedAtWarehouseAt: FUTURE });
    await shipSample(china, s.id, { shippingMode: "EXPRESS_COURIER", trackingNo: "EMS1" });
    await receiveSampleBd(cs, s.id);
    await deliverSample(cs, s.id);
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("DELIVERED");
    const ledger = await customerLedger(row.customerId);
    expect([ledger.invoiced.toString(), ledger.paid.toString(), ledger.balance.toString()]).toEqual(["850", "850", "0"]);
  });
});

describe("sample size and planned shipment", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("stores size + CBM, calculates shipping from the rate, and counts in the planned shipment", async () => {
    const { createStandaloneSample } = await import("@/server/samples");
    const { createShipment, setShipmentStatus } = await import("@/server/shipments");
    const s = await createStandaloneSample(cs, { customer: { name: "Z", phone: "0188", address: "x" }, lines: [{ productName: "Vase", quantity: 1 }] });
    await invoiceSample(china, s.id, { productRmb: "40", shippingRatePerKgRmb: "30", paymentRequired: false, size: { weightKg: "2.5", lengthCm: "40", widthCm: "30", heightCm: "20" } });
    let x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.weightKg?.toString(), x.cartonCount, x.cbm?.toString(), x.shippingToBdRmb?.toString(), x.totalRmb?.toString()]).toEqual(["2.5", 1, "0.024", "75", "115"]);
    expect([x.shippingRatePerKgRmb?.toString(), x.shippingRatePerCbmRmb]).toEqual(["30", null]);

    // edit: a typed amount wins over the rate, the rate is still kept
    await invoiceSample(china, s.id, { productRmb: "40", shippingRatePerKgRmb: "30", shippingToBdRmb: "60", paymentRequired: false, size: { weightKg: "2.5", lengthCm: "40", widthCm: "30", heightCm: "20" } });
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.shippingToBdRmb?.toString(), x.shippingRatePerKgRmb?.toString(), x.totalRmb?.toString()]).toEqual(["60", "30", "100"]);
    // switching to a per-CBM rate clears the per-kg one
    await invoiceSample(china, s.id, { productRmb: "40", shippingRatePerCbmRmb: "2000", paymentRequired: false, size: { weightKg: "2.5", lengthCm: "40", widthCm: "30", heightCm: "20" } });
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.shippingToBdRmb?.toString(), x.shippingRatePerKgRmb, x.shippingRatePerCbmRmb?.toString()]).toEqual(["48", null, "2000"]);

    await purchaseSample(china, s.id, { supplierName: "S", purchaseTrackingUrl: "https://x.example", expectedAtWarehouseAt: FUTURE });
    const planned = await createShipment(admin, { method: "AIR", cutoffDate: FUTURE, openNow: true });
    await expect(shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT" })).rejects.toThrow(/planned shipment/);
    await shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", shipmentId: planned.id, size: { weightKg: "3", cartonCount: 2, lengthCm: "40", widthCm: "30", heightCm: "20" } });
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    expect([x.cbm?.toString(), x.etaBd?.toISOString(), x.carrierName]).toEqual(["0.048", planned.etaBd?.toISOString(), null]);
    const sh = await prisma.shipment.findUniqueOrThrow({ where: { id: planned.id } });
    expect([sh.itemCount, sh.cartonCount, sh.grossWeightKg.toString(), sh.cbm.toString()]).toEqual([1, 2, "3", "0.048"]);

    // switching to a courier takes it out of the shipment totals
    await shipSample(china, s.id, { shippingMode: "EXPRESS_COURIER", trackingNo: "SF123" });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: planned.id } })).itemCount).toBe(0);

    // back in, then the shipment departs: the sample's timeline gets the update
    await shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", shipmentId: planned.id });
    await setShipmentStatus(china, planned.id, "DEPARTED");
    expect(await prisma.sampleEvent.count({ where: { sampleId: s.id, message: { contains: "Departed China" } } })).toBe(1);
  });
});

describe("sample paid in two parts", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("product before purchase, shipping collected on delivery; no overpayment", async () => {
    const { createStandaloneSample, sampleBalance } = await import("@/server/samples");
    const { customerLedger } = await import("@/server/ledger");
    const s = await createStandaloneSample(cs, { customer: { name: "Two", phone: "0166", address: "x" }, lines: [{ productName: "Lamp", quantity: 1 }] });
    // product 50 + service 10 = ¥60 → ৳1,020 before purchase; shipping ¥40 → ৳680 on delivery
    await invoiceSample(china, s.id, { productRmb: "50", serviceRmb: "10", shippingToBdRmb: "40", paymentRequired: true });
    const row = () => prisma.sample.findUniqueOrThrow({ where: { id: s.id } });
    let a = await sampleBalance(await row());
    expect([a.total, a.beforePurchase, a.onDelivery, a.upfrontDue].map(String)).toEqual(["1700", "1020", "680", "1020"]);

    // partial upfront keeps China waiting
    await recordSamplePayment(cs, s.id, { amountBdt: "500", method: "BKASH" });
    expect((await row()).status).toBe("AWAITING_PAYMENT");
    await recordSamplePayment(cs, s.id, { amountBdt: "520", method: "BKASH" });
    expect((await row()).status).toBe("PAID");
    await expect(recordSamplePayment(cs, s.id, { amountBdt: "700", method: "CASH" })).rejects.toThrow(/more than the balance due \(৳680.00\)/);

    await purchaseSample(china, s.id, { supplierName: "S", purchaseTrackingUrl: "https://x.example", expectedAtWarehouseAt: FUTURE });
    await shipSample(china, s.id, { shippingMode: "HAND_CARRY" });
    await receiveSampleBd(cs, s.id);
    await expect(deliverSample(cs, s.id, "ok", { amountBdt: "681", method: "CASH" })).rejects.toThrow(/balance due/);
    await deliverSample(cs, s.id, "ok", { amountBdt: "680", method: "CASH" });
    a = await sampleBalance(await row());
    expect([(await row()).status, a.paid.toString(), a.balance.toString()]).toEqual(["DELIVERED", "1700", "0"]);
    expect(await prisma.sampleEvent.count({ where: { sampleId: s.id, message: { startsWith: "Collected on delivery ৳680.00" } } })).toBe(1);
    const ledger = await customerLedger((await row()).customerId);
    expect(ledger.balance.toString()).toBe("0");
  });

  it("can deliver without collecting; balance stays due", async () => {
    const { createStandaloneSample, sampleBalance } = await import("@/server/samples");
    const s = await createStandaloneSample(cs, { customer: { name: "Due", phone: "0155", address: "x" }, lines: [{ productName: "Cup", quantity: 1 }] });
    await invoiceSample(china, s.id, { productRmb: "10", shippingToBdRmb: "10", paymentRequired: false });
    await purchaseSample(china, s.id, { supplierName: "S", purchaseTrackingUrl: "https://x.example", expectedAtWarehouseAt: FUTURE });
    await shipSample(china, s.id, { shippingMode: "POST" });
    await receiveSampleBd(cs, s.id);
    await deliverSample(cs, s.id);
    const a = await sampleBalance(await prisma.sample.findUniqueOrThrow({ where: { id: s.id } }));
    expect(a.balance.toString()).toBe("340");
  });
});
