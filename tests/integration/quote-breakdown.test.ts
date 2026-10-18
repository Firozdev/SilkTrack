import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createRequest } from "@/server/requests";
import { saveQuotation, sendQuotationToCustomer, setSellingPrices, setUnitSellingPrices } from "@/server/estimates";
import { addShippingRate } from "@/server/shipping-rates";
import { portalOrder } from "@/server/portal";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb, submitAsLegacy } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

/** Lamp 10 × 0.35 kg + Shade 4 × 1.2 kg = 8.3 kg by air. */
async function sentQuote(shippingMethod: "AIR" | "SEA" = "AIR") {
  const { order } = await createRequest(cs, {
    customer: { name: "Q", phone: "01500000000", address: "x" },
    shippingMethod,
    lines: [
      { productName: "Lamp", quantity: 10, links: [] },
      { productName: "Shade", quantity: 4, links: [] },
    ],
  });
  const e = await saveQuotation(china, order.id, {
    shippingMethod,
    shippingRatePerKgRmb: "40",
    shippingRatePerCbmRmb: "1000",
    validUntil: new Date("2099-01-01T00:00:00Z"),
    lines: [
      { orderLineId: order.lines[0].id, unitPriceRmb: "12.50", unitWeightKg: "0.35", cartonCount: 1, lengthCm: "50", widthCm: "40", heightCm: "30" },
      { orderLineId: order.lines[1].id, unitPriceRmb: "30", unitWeightKg: "1.2", cartonCount: 2, lengthCm: "20", widthCm: "20", heightCm: "20" },
    ],
  });
  await submitAsLegacy(e.id);
  const el = await prisma.estimateLine.findMany({ where: { estimateId: e.id }, orderBy: { productName: "asc" } });
  await setSellingPrices(cs, e.id, [
    { lineId: el[0].id, sellingPriceBdt: "4500" }, // Lamp: 450 each
    { lineId: el[1].id, sellingPriceBdt: "1200" }, // Shade: 300 each
  ]);
  await sendQuotationToCustomer(cs, e.id);
  return order;
}

describe("Customer quotation breakdown", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("shows unit price, total purchase price and estimated shipping from the rate live when sent", async () => {
    await addShippingRate(admin, { airPerKgBdt: "750", seaPerCbmBdt: "28000", localDeliveryBdt: "120" }, new Date(Date.now() - 60_000));
    const order = await sentQuote();
    const view = await portalOrder(order.customerId, order.id);
    const b = view!.quote!.breakdown;
    expect(b.lines.map((l) => [l.productName, l.quantity, l.unitPrice?.toString(), l.amount?.toString()]).sort()).toEqual([
      ["Lamp", 10, "450", "4500"],
      ["Shade", 4, "300", "1200"],
    ]);
    expect(b.products.toString()).toBe("5700");
    expect([b.shipping?.basis.toString(), b.shipping?.unit, b.shipping?.rate.toString(), b.shipping?.amount.toString()]).toEqual(["8.3", "kg", "750", "6225"]);
    expect([b.delivery.toString(), b.estimatedTotal.toString()]).toEqual(["120", "12045"]); // 5700 + 6225 + 120

    // A later rate change doesn't change a quote already sent
    await addShippingRate(admin, { airPerKgBdt: "1000", localDeliveryBdt: "200" });
    expect((await portalOrder(order.customerId, order.id))!.quote!.breakdown.estimatedTotal.toString()).toBe("12045");

    // The customer's WhatsApp message carries the same breakdown
    const msg = await prisma.notification.findFirstOrThrow({ where: { type: "QUOTE_READY" } });
    expect(msg.body).toMatch(/Products: ৳5700\.00; estimated shipping ৳6345\.00 \(can change with your lot's actual weight\/CBM\); estimated total ৳12045\.00/);
  });

  it("sea quotes use CBM; without a shipping rate only the products are totalled", async () => {
    await addShippingRate(admin, { seaPerCbmBdt: "28000" }, new Date(Date.now() - 60_000));
    const sea = await sentQuote("SEA");
    const b = (await portalOrder(sea.customerId, sea.id))!.quote!.breakdown;
    expect([b.shipping?.unit, b.shipping?.basis.toString(), b.shipping?.amount.toString()]).toEqual(["CBM", "0.076", "2128"]); // 0.06 + 2 × 0.008

    await prisma.shippingRate.deleteMany();
    const b2 = (await portalOrder(sea.customerId, sea.id))!.quote!.breakdown;
    expect([b2.shipping, b2.products.toString(), b2.estimatedTotal.toString()]).toEqual([null, "5700", "5700"]);
  });

  it("CS enters the price per unit: 1500 × 3 pieces shows unit 1500 and amount 4500", async () => {
    const { order } = await createRequest(cs, { customer: { name: "U", phone: "01600000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 3, links: [] }] });
    const e = await saveQuotation(china, order.id, { shippingMethod: "AIR", shippingRatePerKgRmb: "40", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: order.lines[0].id, unitPriceRmb: "50" }] });
    await submitAsLegacy(e.id);
    const [line] = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await expect(setUnitSellingPrices(cs, e.id, [{ lineId: "nope", unitPriceBdt: "1" }])).rejects.toThrow(/Unknown product line/);
    await setUnitSellingPrices(cs, e.id, [{ lineId: line.id, unitPriceBdt: "1500" }]);
    expect((await prisma.estimateLine.findUniqueOrThrow({ where: { id: line.id } })).sellingPriceBdt?.toString()).toBe("4500");
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: e.id } })).grandTotalBdt?.toString()).toBe("4500");
    await sendQuotationToCustomer(cs, e.id);
    const b = (await portalOrder(order.customerId, order.id))!.quote!.breakdown;
    expect([b.lines[0].unitPrice?.toString(), b.lines[0].amount?.toString(), b.products.toString()]).toEqual(["1500", "4500", "4500"]);
  });

  it("customer-facing data still never includes RMB cost, rate or margin", async () => {
    const order = await sentQuote();
    const json = JSON.stringify(await portalOrder(order.customerId, order.id));
    for (const secret of ["unitPriceRmb", "totalRmb", "rateUsed", "marginBdt", "shippingRmb", "productCostBdt"]) expect(json).not.toContain(secret);
  });
});
