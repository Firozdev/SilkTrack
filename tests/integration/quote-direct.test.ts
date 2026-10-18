import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, addDays, toYmd, today } from "@/lib/dates";
import { acceptInvite, approveAccount, signUp } from "@/server/portal-auth";
import { assignAgent, createAgent } from "@/server/agents";
import { placedBy } from "@/server/portal-access";
import { createPortalRequest } from "@/server/requests";
import { portalOrder, portalSample } from "@/server/portal";
import { saveQuotation, submitQuotation, type QuotationInput } from "@/server/estimates";
import { invoiceSample, purchaseSample, recordSamplePayment, requestSampleFromPortal, shipSample } from "@/server/samples";
import { createShipment } from "@/server/shipments";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function customerAndAgent() {
  const acc = await signUp({ name: "Karim", phone: "01711000000", password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const customer = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  const { token, account } = await createAgent(admin, { name: "Rafiq", phone: "01911000000" });
  await acceptInvite(token, "agent-pass-123");
  await assignAgent(admin, customer.customerId!, account.id);
  const agent = { id: account.id, name: account.name, kind: "AGENT" as const, customer: null };
  return { customer, agent, customerId: customer.customerId! };
}

const quote = (lines: { id: string }[]): QuotationInput => ({
  shippingMethod: "AIR",
  shippingRatePerKgRmb: "40",
  domesticShippingRmb: "15",
  serviceFeeRmb: "10",
  validUntil: FUTURE,
  lines: [
    { orderLineId: lines[0].id, unitPriceRmb: "12.50", unitWeightKg: "0.35" },
    { orderLineId: lines[1].id, unitPriceRmb: "30", unitWeightKg: "1.2" },
  ],
});

const notified = async (type: string) => {
  const rows = await prisma.notification.findMany({ where: { type }, select: { userId: true, portalAccountId: true } });
  return { staff: rows.map((r) => r.userId).filter(Boolean).sort(), accounts: rows.map((r) => r.portalAccountId).filter(Boolean).sort() };
};

describe("China's quotation goes straight to the agent / customer", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
  });

  it("submit = sent: today's rate, BDT = RMB × rate (no markup), request Quoted, agent + customer + CS + Admin notified", async () => {
    // Saved while only yesterday's rate existed; today's rate is entered before China submits.
    await makeRate(toYmd(addDays(today(BD_TZ), -1)), "16", admin.id);
    const { customer, agent, customerId } = await customerAndAgent();
    const { order } = await createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }, { productName: "Shade", quantity: 4, links: [] }] }, placedBy(agent));
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
    const e = await saveQuotation(china, order.id, quote(lines));
    expect(e.rateUsed.toString()).toBe("16");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);

    await submitQuotation(china, e.id);
    const x = await prisma.estimate.findUniqueOrThrow({ where: { id: e.id }, include: { lines: { orderBy: { productName: "asc" } } } });
    // products ¥245 + China costs ¥25 = ¥270 × 17 = ৳4,590, spread by RMB value
    expect([x.status, x.rateUsed.toString(), x.productCostBdt.toString(), x.grandTotalBdt?.toString(), x.marginBdt?.toString()]).toEqual(["SENT_TO_CUSTOMER", "17", "4590", "4590", "0"]);
    expect(x.lines.map((l) => [l.productName, l.sellingPriceBdt?.toString()])).toEqual([
      ["Lamp", "2341.84"],
      ["Shade", "2248.16"],
    ]);
    expect(x.sentAt).not.toBeNull();
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(o.requestStatus).toBe("QUOTED");
    expect(o.lines.map((l) => [l.quotedUnitPriceRmb?.toString(), l.sellingPriceBdt?.toString(), l.status])).toEqual([
      ["12.5", "2341.84", "QUOTED"],
      ["30", "2248.16", "QUOTED"],
    ]);

    const n = await notified("QUOTE_SENT");
    expect(n.accounts).toEqual([agent.id, customer.id].sort());
    expect(n.staff).toEqual([admin.id, cs.id].sort()); // never China, who sent it
    await expect(submitQuotation(china, e.id)).rejects.toThrow(/Only drafts/);
    await expect(submitQuotation(cs, e.id)).rejects.toThrow(ForbiddenError);

    // The customer sees RMB and BDT, and the rate
    const p = await portalOrder(customerId, order.id);
    expect(p?.quote?.rmb).toMatchObject({ products: expect.anything(), total: expect.anything() });
    expect([p?.quote?.rmb?.products.toString(), p?.quote?.rmb?.chinaCharges.toString(), p?.quote?.rmb?.total.toString(), p?.quote?.rmb?.rate.toString()]).toEqual(["245", "25", "270", "17"]);
    expect(p?.quote?.lines.map((l) => l.rmbPrice?.unit.toString())).toEqual(expect.arrayContaining(["12.5", "30"]));
    expect(JSON.stringify(p)).not.toMatch(/marginBdt|profitBdt|productCostBdt/);
  });

  it("an expired valid-until date can't be submitted", async () => {
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
    const { customerId } = await customerAndAgent();
    const { order } = await createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }, { productName: "Shade", quantity: 1, links: [] }] });
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
    const e = await saveQuotation(china, order.id, { ...quote(lines), validUntil: new Date("2020-01-01T00:00:00Z") });
    await expect(submitQuotation(china, e.id)).rejects.toThrow(/valid-until/);
  });
});

describe("Sample from the quotation, requested in the portal", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("agent asks → China invoices (ship way + free shipping charge) → customer + agent notified → payment confirmed → China buys and ships by air / sea / hand carry", async () => {
    const { customer, agent, customerId } = await customerAndAgent();
    const { order } = await createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }, { productName: "Shade", quantity: 4, links: [] }] }, placedBy(agent));
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
    const e = await saveQuotation(china, order.id, quote(lines));
    const ask = { lines: [{ orderLineId: lines[0].id, quantity: 1 }], note: "red one" };

    // Not before the quotation is sent; never on someone else's order
    await expect(requestSampleFromPortal(agent, customerId, order.id, ask)).rejects.toThrow(/once you have the quotation/);
    await submitQuotation(china, e.id);
    const other = await prisma.customer.create({ data: { code: "C-99999", name: "Other", phone: "01611000000", address: "x" } });
    await expect(requestSampleFromPortal(agent, other.id, order.id, ask)).rejects.toThrow(/Not found/);

    const s = await requestSampleFromPortal(agent, customerId, order.id, ask);
    let x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id }, include: { events: true } });
    expect([x.status, x.requestedById, x.requestedByAccountId, x.requestNote]).toEqual(["REQUESTED", null, agent.id, "red one"]);
    expect(x.events[0].message).toMatch(/in the portal by Rafiq/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).requestStatus).toBe("SAMPLING");
    expect((await notified("SAMPLE_REQUESTED")).staff).toEqual([admin.id, china.id, cs.id].sort());

    // China prepares the sample invoice (CS / Admin may too; BD Warehouse can't): free ¥ shipping charge + ship way
    const bdw = await makeUser("BD_WAREHOUSE");
    await expect(invoiceSample(bdw, s.id, { shipWay: "SEA", productRmb: "25", paymentRequired: true })).rejects.toThrow(ForbiddenError);
    await expect(invoiceSample(china, s.id, { shipWay: "BOAT" as never, productRmb: "25", paymentRequired: true })).rejects.toThrow(/hand carry, air shipment or sea shipment/);
    await expect(invoiceSample(china, s.id, { shipWay: "SEA", productRmb: "25", shippingToBdRmb: "-5", paymentRequired: true })).rejects.toThrow(/negative/);
    await invoiceSample(china, s.id, { shipWay: "SEA", productRmb: "25", shippingToBdRmb: "15", paymentRequired: true });
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id }, include: { events: true } });
    expect([x.shipWay, x.totalRmb?.toString(), x.totalBdt?.toString(), x.invoicedById]).toEqual(["SEA", "40", "680", china.id]);
    const inv = await notified("SAMPLE_INVOICED");
    expect(inv.accounts).toEqual([agent.id, customer.id].sort());
    expect(inv.staff).toEqual([admin.id, cs.id].sort());

    // The customer sees product ৳425 and shipping ৳255, both due – never the RMB cost lines
    let p = await portalSample(customerId, s.id);
    expect([p?.parts.product.toString(), p?.parts.productDue.toString(), p?.parts.shipping.toString(), p?.parts.shippingDue.toString()]).toEqual(["425", "425", "255", "255"]);
    expect(JSON.stringify(p)).not.toMatch(/productRmb|serviceRmb|shippingToBdRmb|chinaShippingRmb/);

    // Product only → China (and the customer) told; China buys; the shipping stays due
    const buy = (paidRmb = "28.50") => purchaseSample(china, s.id, { supplierName: "Shop", purchaseTrackingUrl: "https://t.example/1", expectedAtWarehouseAt: FUTURE, paidRmb });
    await expect(buy()).rejects.toThrow(/Waiting/);
    await recordSamplePayment(cs, s.id, { amountBdt: "425", method: "BKASH" });
    const paid = await notified("SAMPLE_PAID");
    expect([paid.staff, paid.accounts]).toEqual([[china.id], [agent.id, customer.id].sort()]);
    p = await portalSample(customerId, s.id);
    expect([p?.parts.productDue.toString(), p?.parts.shippingDue.toString(), p?.balance.toString()]).toEqual(["0", "255", "255"]);
    // The RMB China spent is required (> 0), saved with today's rate, audited – and never shown in the portal
    await expect(buy("")).rejects.toThrow(/total RMB paid/);
    await expect(buy("0")).rejects.toThrow(/total RMB paid/);
    await expect(buy("abc")).rejects.toThrow(/total RMB paid/);
    await buy();
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id }, include: { events: true } });
    expect([x.status, x.paidRmb?.toString(), x.purchaseRate?.toString(), x.paidBdt?.toString()]).toEqual(["PURCHASED", "28.5", "17", "484.5"]);
    const audit = await prisma.auditLog.findMany({ where: { entityId: s.id, field: { in: ["paidRmb", "paidVsInvoicedRmb"] } } });
    expect(audit.map((a) => [a.field, a.newValue]).sort()).toEqual([
      ["paidRmb", "28.50"],
      ["paidVsInvoicedRmb", "3.50"],
    ]);
    expect(JSON.stringify(await portalSample(customerId, s.id))).not.toMatch(/paidRmb|paidBdt|purchaseRate/);
    await recordSamplePayment(cs, s.id, { amountBdt: "255", method: "BKASH" });
    p = await portalSample(customerId, s.id);
    expect([p?.parts.shippingDue.toString(), p?.balance.toString()]).toEqual(["0", "0"]);

    // Three ways only: hand carry, air shipment, sea shipment (shipment must match)
    const air = await createShipment(admin, { method: "AIR", cutoffDate: FUTURE, openNow: true });
    const sea = await createShipment(admin, { method: "SEA", cutoffDate: FUTURE, openNow: true });
    await expect(shipSample(china, s.id, { shippingMode: "POST" })).rejects.toThrow(/hand carry, air shipment or sea shipment/);
    await expect(shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", shipmentId: air.id })).rejects.toThrow(/air or sea/);
    await expect(shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", method: "SEA", shipmentId: air.id })).rejects.toThrow(/not a sea shipment/);
    await shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", method: "SEA", shipmentId: sea.id });
    x = await prisma.sample.findUniqueOrThrow({ where: { id: s.id }, include: { events: { orderBy: { occurredAt: "asc" } } } });
    expect([x.status, x.shipmentId]).toEqual(["SHIPPED", sea.id]);
    expect(x.events.at(-1)?.message).toMatch(/sea shipment/);
    await shipSample(china, s.id, { shippingMode: "HAND_CARRY", carrierName: "Mr. Li" });
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: s.id } })).shipmentId).toBeNull();
  });
});
