import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, redactFor } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createShipment } from "@/server/shipments";
import {
  assignShippingOrder,
  cancelShippingOrder,
  createShippingOrder,
  deliverShipping,
  dispatchShipping,
  findShippingByTracking,
  invoiceShipping,
  receiveShippingBd,
  receiveShippingChina,
  recordQa,
  recordShippingPayment,
  setShippingHold,
  updateShippingTracking,
} from "@/server/shipping-orders";
import { customerLedger } from "@/server/ledger";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const FUTURE = new Date("2099-01-05T00:00:00Z");

async function newOrder(over: { qaRequested?: boolean; shippingMethod?: "AIR" | "SEA" } = {}) {
  return createShippingOrder(cs, {
    customer: { name: "Rahim", phone: "01700000000", address: "Dhanmondi" },
    shippingMethod: over.shippingMethod ?? "AIR",
    qaRequested: over.qaRequested ?? false,
    declaredWeightKg: "10",
    items: [
      { productName: "Shoes", quantity: 20, courierName: "ZTO", trackingNo: "ZT123456" },
      { productName: "Bags", quantity: 5 },
    ],
  });
}

async function receive(id: string) {
  const items = await prisma.shippingOrderItem.findMany({ where: { shippingOrderId: id }, orderBy: { lineNo: "asc" } });
  await receiveShippingChina(china, id, {
    items: items.map((i) => ({ itemId: i.id, quantityReceived: i.quantity, condition: "OK" })),
    cartons: [
      { lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "8.5" },
      { lengthCm: "40", widthCm: "30", heightCm: "20", grossWeightKg: "4" },
    ],
  });
}

const get = (id: string) => prisma.shippingOrder.findUniqueOrThrow({ where: { id } });

describe("Shipping-only service", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("runs the full flow: request → China → shipment → BD → invoice → paid → delivered", async () => {
    await expect(newOrder().then(() => createShippingOrder(china, { customer: { name: "x", phone: "0170000000", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "a", quantity: 1 }] }))).rejects.toThrow(ForbiddenError);
    const so = await prisma.shippingOrder.findFirstOrThrow();
    expect(so.status).toBe("REQUESTED");
    expect(so.source).toBe("STAFF");

    // China finds it by the supplier tracking number
    expect((await findShippingByTracking("zt1234")).map((x) => x.id)).toEqual([so.id]);

    await receive(so.id);
    let s = await get(so.id);
    expect(s.status).toBe("RECEIVED_CHINA");
    expect([s.grossWeightKg, s.cbm].map(String)).toEqual(["12.5", "0.084"]); // 0.06 + 0.024
    expect(s.cartonCount).toBe(2);

    // QA was not requested
    await expect(recordQa(china, so.id, { result: "PASSED" })).rejects.toThrow(/did not ask/);

    const { shipment } = await assignShippingOrder(china, so.id, "auto");
    expect(shipment.method).toBe("AIR");
    expect(shipment.itemCount).toBe(1);
    expect(shipment.grossWeightKg.toString()).toBe("12.5");
    expect((await get(so.id)).status).toBe("IN_SHIPMENT");

    await expect(invoiceShipping(cs, so.id, { ratePerUnitBdt: "800" })).rejects.toThrow(/received in Bangladesh/);
    await expect(receiveShippingBd(china, so.id)).rejects.toThrow(ForbiddenError);
    await receiveShippingBd(cs, so.id);

    // Billed on China gross weight: 12.5 kg × 800 = 10000 + 120 delivery − 100 discount
    await invoiceShipping(cs, so.id, { ratePerUnitBdt: "800", localDeliveryBdt: "120", discountBdt: "100" });
    s = await get(so.id);
    expect(s.status).toBe("INVOICED");
    expect([s.billWeightKg, s.shippingChargeBdt, s.invoiceTotalBdt, s.rateUsed].map(String)).toEqual(["12.5", "10000", "10020", "17.25"]);

    await expect(recordShippingPayment(cs, so.id, { amountBdt: "20000", method: "BKASH" })).rejects.toThrow(/balance due/);
    await recordShippingPayment(cs, so.id, { amountBdt: "5000", method: "BKASH" });
    expect((await get(so.id)).status).toBe("INVOICED");
    await expect(dispatchShipping(cs, so.id, { courier: "PATHAO" })).rejects.toThrow(/fully paid/);
    await recordShippingPayment(cs, so.id, { amountBdt: "5020", method: "CASH" });
    expect((await get(so.id)).status).toBe("READY_FOR_DELIVERY");

    await dispatchShipping(cs, so.id, { courier: "PATHAO", trackingNo: "PT-1" });
    await deliverShipping(cs, so.id, "Rahim");
    s = await get(so.id);
    expect(s.status).toBe("DELIVERED");
    expect(s.receiverName).toBe("Rahim");

    const ledger = await customerLedger(s.customerId);
    expect([ledger.invoiced, ledger.paid, ledger.balance].map(String)).toEqual(["10020", "10020", "0"]);

    const events = await prisma.shippingOrderEvent.findMany({ where: { shippingOrderId: so.id }, orderBy: { occurredAt: "asc" } });
    expect(events.filter((e) => e.status).map((e) => e.status)).toEqual(["REQUESTED", "RECEIVED_CHINA", "IN_SHIPMENT", "RECEIVED_BD", "INVOICED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    const audited = await prisma.auditLog.findMany({ where: { entityType: "ShippingOrder", entityId: so.id }, select: { field: true } });
    expect(audited.map((a) => a.field)).toEqual(expect.arrayContaining(["status", "grossWeightKg", "cbm", "invoiceTotalBdt", "rateUsed", "shipRatePerKgBdt"]));
  });

  it("requires the QA test before shipping when the customer asked for it", async () => {
    const so = await newOrder({ qaRequested: true });
    await receive(so.id);
    await expect(assignShippingOrder(china, so.id, "auto")).rejects.toThrow(/QA test/);
    await expect(recordQa(cs, so.id, { result: "FAILED" })).rejects.toThrow(ForbiddenError);
    await recordQa(china, so.id, { result: "FAILED", notes: "Stitching loose" });
    expect((await get(so.id)).status).toBe("QA_DONE");
    const n = await prisma.notification.findFirst({ where: { type: "SHIPPING_QA_FAILED", userId: cs.id } });
    expect(n?.body).toMatch(/Stitching loose/);

    // BD puts it on hold; nothing moves until released, then it returns to QA done
    await setShippingHold(cs, so.id, true, "Asking customer");
    await expect(assignShippingOrder(china, so.id, "auto")).rejects.toThrow(/on hold/);
    await setShippingHold(cs, so.id, false);
    expect((await get(so.id)).status).toBe("QA_DONE");
    await assignShippingOrder(china, so.id, "auto");
    expect((await get(so.id)).status).toBe("IN_SHIPMENT");
  });

  it("sea orders bill on CBM and only go into sea shipments", async () => {
    const so = await newOrder({ shippingMethod: "SEA" });
    await receive(so.id);
    const air = await createShipment(admin, { method: "AIR", cutoffDate: FUTURE, openNow: true });
    await expect(assignShippingOrder(china, so.id, air.id)).rejects.toThrow(/air shipment/);
    await assignShippingOrder(china, so.id, "auto");
    await receiveShippingBd(cs, so.id);
    await invoiceShipping(cs, so.id, { ratePerUnitBdt: "25000", qaFeeBdt: "0" });
    const s = await get(so.id);
    expect([s.billCbm, s.shipRatePerCbmBdt, s.shippingChargeBdt, s.invoiceTotalBdt].map(String)).toEqual(["0.084", "25000", "2100", "2100"]);
    expect(s.shipRatePerKgBdt).toBeNull();
  });

  it("moving between shipments and cancelling keep shipment totals right", async () => {
    const so = await newOrder();
    await receive(so.id);
    const a = (await assignShippingOrder(china, so.id, "auto")).shipment;
    const b = await createShipment(admin, { method: "AIR", cutoffDate: FUTURE, openNow: true });
    await assignShippingOrder(china, so.id, b.id);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: a.id } })).itemCount).toBe(0);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: b.id } })).itemCount).toBe(1);
    await cancelShippingOrder(cs, so.id, "Customer changed mind");
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: b.id } })).itemCount).toBe(0);
    expect((await get(so.id)).shipmentId).toBeNull();
  });

  it("tracking can be added later, until the goods are received", async () => {
    const so = await newOrder();
    const bags = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id, productName: "Bags" } });
    await updateShippingTracking(cs, so.id, [{ itemId: bags.id, courierName: "SF", trackingNo: "SF999" }]);
    expect((await findShippingByTracking("SF999")).length).toBe(1);
    await receive(so.id);
    await expect(updateShippingTracking(cs, so.id, [{ itemId: bags.id, trackingNo: "X" }])).rejects.toThrow(/before the goods are received/);
  });

  it("hides customer charges from the China team", async () => {
    const so = await newOrder();
    await receive(so.id);
    await assignShippingOrder(china, so.id, "auto");
    await receiveShippingBd(cs, so.id);
    await invoiceShipping(cs, so.id, { ratePerUnitBdt: "800" });
    const row = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id }, include: { payments: true } });
    const seen = redactFor({ role: "PURCHASE" }, row) as Record<string, unknown>;
    for (const k of ["invoiceTotalBdt", "shippingChargeBdt", "shipRatePerKgBdt", "payments"]) expect(seen).not.toHaveProperty(k);
    expect(seen).toHaveProperty("grossWeightKg");
  });
});
