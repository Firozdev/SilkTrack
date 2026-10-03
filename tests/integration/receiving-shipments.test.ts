import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { createRequest, recordPayment } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { findByTracking, receiveParcel, repack } from "@/server/receiving";
import { createShipment, moveReceiving, removeFromShipment, setFreight, setShipmentStatus, shipmentCode, suggestShipment } from "@/server/shipments";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
// Wed 1 Oct 2026, 10:00 China time → ISO week 40, cut-off Sat 3 Oct
const NOW = new Date("2026-10-01T02:00:00Z");

async function purchased(qty = 4, method: "AIR" | "SEA" = "AIR", tracking = "YT100") {
  const { order } = await createRequest(cs, {
    customer: { name: "Cust", phone: `0170${Math.floor(Math.random() * 1e7)}`, address: "x" },
    shippingMethod: method,
    lines: [
      { productName: "Shoe", quantity: qty, links: [] },
      { productName: "Bag", quantity: 2, links: [] },
    ],
  });
  await quoteAndApprove(order.id, "10", "999");
  await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "100", method: "CASH" });
  const so = await createPurchase(china, { ...DONE,
    supplierName: "S",
    platform: "TAOBAO",
    lines: order.lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })),
  });
  await markShippedBySupplier(china, so.id, { courierName: "YTO", trackingNo: tracking });
  const pls = await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id }, include: { orderLine: true }, orderBy: { orderLine: { lineNo: "asc" } } });
  return { order, so, pls };
}

const carton = { lengthCm: "50", widthCm: "40", heightCm: "30" }; // 0.06 m³

describe("China receiving + weekly shipments", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate("2026-09-30", "17.0000", admin.id);
  });

  it("plans a shipment by hand from its cut-off date", async () => {
    const s = await createShipment(china, { method: "SEA", cutoffDate: new Date("2026-10-17T00:00:00Z"), forwarder: "Ocean Co", masterTrackingNo: "BL-9", openNow: true });
    expect([s.code, s.status, s.forwarder, s.masterTrackingNo]).toEqual(["SHP-2026-W42-S", "OPEN", "Ocean Co", "BL-9"]);
    expect(s.plannedDepartureDate?.toISOString().slice(0, 10)).toBe("2026-10-19");
    await expect(createShipment(admin, { method: "SEA", cutoffDate: new Date("2026-10-14T00:00:00Z") })).rejects.toThrow(/already planned/);
    await expect(createShipment(cs, { method: "AIR", cutoffDate: new Date("2026-10-17T00:00:00Z") })).rejects.toThrow(ForbiddenError);
  });

  it("codes shipments per week and method", () => {
    expect(shipmentCode(2026, 40, "AIR")).toBe("SHP-2026-W40-A");
    expect(shipmentCode(2026, 7, "SEA")).toBe("SHP-2026-W07-S");
  });

  it("finds purchases by supplier tracking number", async () => {
    await purchased(4, "AIR", "YT55501");
    const found = await findByTracking("55501");
    expect(found).toHaveLength(1);
    expect(found[0].lines.map((l) => l.received)).toEqual([0, 0]);
  });

  it("receives a parcel, computes CBM, and auto-assigns this week's open air shipment", async () => {
    const { order, so, pls } = await purchased();
    const r = await receiveParcel(
      china,
      {
        supplierOrderId: so.id,
        condition: "OK",
        grossWeightKg: "5.5",
        netWeightKg: "5",
        cartons: [carton, { lengthCm: "10", widthCm: "10", heightCm: "10" }],
        shippingMethod: "AIR",
        shipmentId: "auto",
        lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })),
      },
      NOW,
    );
    expect(r.receiving.cbm.toString()).toBe("0.061");
    expect(r.shipment?.code).toBe("SHP-2026-W40-A");
    expect(r.shipment?.status).toBe("OPEN");
    expect(r.shipment?.grossWeightKg.toString()).toBe("5.5");
    expect(r.shipment?.cartonCount).toBe(2);
    expect((await prisma.supplierOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("RECEIVED_AT_CHINA_WAREHOUSE");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("IN_SHIPMENT");
  });

  it("after cut-off, items go to next week's shipment", async () => {
    const saturdayNight = new Date("2026-10-04T02:00:00Z"); // Sun 4 Oct in China
    const s = await prisma.$transaction((tx) => suggestShipment(tx, "AIR", saturdayNight));
    expect(s.code).toBe("SHP-2026-W41-A");
  });

  it("supports partial receiving and opens issue tickets", async () => {
    const { so, pls, order } = await purchased(4);
    await receiveParcel(
      china,
      { supplierOrderId: so.id, condition: "OK", grossWeightKg: "1", cartons: [carton], shippingMethod: "AIR", shipmentId: null, lines: [{ purchaseLineId: pls[0].id, quantityReceived: 3, condition: "SHORT" }] },
      NOW,
    );
    expect((await prisma.supplierOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("SHIPPED_BY_SUPPLIER");
    const issue = await prisma.issue.findFirstOrThrow();
    expect(issue).toMatchObject({ type: "SHORT", source: "CHINA_RECEIVING", assignedToId: china.id, orderId: order.id });
    await expect(
      receiveParcel(china, { supplierOrderId: so.id, condition: "OK", grossWeightKg: "1", cartons: [carton], shippingMethod: "AIR", shipmentId: null, lines: [{ purchaseLineId: pls[0].id, quantityReceived: 2, condition: "OK" }] }, NOW),
    ).rejects.toThrow(/more than ordered/);
  });

  it("CS cannot receive", async () => {
    const { so, pls } = await purchased();
    await expect(
      receiveParcel(cs, { supplierOrderId: so.id, condition: "OK", grossWeightKg: "1", cartons: [carton], shippingMethod: "AIR", shipmentId: null, lines: [{ purchaseLineId: pls[0].id, quantityReceived: 1, condition: "OK" }] }, NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  it("moves items between shipments until closed, then status cascades to every line", async () => {
    const { so, pls, order } = await purchased();
    const r = await receiveParcel(
      china,
      { supplierOrderId: so.id, condition: "OK", grossWeightKg: "2", cartons: [carton], shippingMethod: "AIR", shipmentId: "auto", lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) },
      NOW,
    );
    const w41 = await createShipment(admin, { method: "AIR", cutoffDate: new Date("2026-10-10T00:00:00Z"), maxWeightKg: "1" });
    const warning = await moveReceiving(china, r.receiving.id, w41.id);
    expect(warning).toMatch(/over capacity/);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: r.shipment!.id } })).itemCount).toBe(0);

    await setShipmentStatus(china, w41.id, "CLOSED");
    // next week auto-created and open
    expect((await prisma.shipment.findUniqueOrThrow({ where: { code: "SHP-2026-W42-A" } })).status).toBe("OPEN");
    await expect(removeFromShipment(china, r.receiving.id)).rejects.toThrow(/closed/);

    await setShipmentStatus(china, w41.id, "DEPARTED");
    let lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    expect(lines.every((l) => l.status === "IN_TRANSIT")).toBe(true);
    await expect(setShipmentStatus(china, w41.id, "ARRIVED_BD")).rejects.toThrow(/Only Admin/);
    await setShipmentStatus(admin, w41.id, "ARRIVED_BD");
    lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    expect(lines.every((l) => l.status === "ARRIVED_BD")).toBe(true);
    expect(await prisma.notification.count({ where: { channel: "WHATSAPP", type: "ARRIVED_BD" } })).toBe(1);
    await expect(setShipmentStatus(admin, w41.id, "OPEN")).rejects.toThrow(/forward/);
  });

  it("splits freight by gross weight (air) down to lines", async () => {
    const a = await purchased(4, "AIR", "T1");
    const b = await purchased(1, "AIR", "T2");
    const recv = async (x: typeof a, kg: string) =>
      receiveParcel(china, { supplierOrderId: x.so.id, condition: "OK", grossWeightKg: kg, cartons: [carton], shippingMethod: "AIR", shipmentId: "auto", lines: x.pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) }, NOW);
    const r1 = await recv(a, "3");
    const r2 = await recv(b, "1");
    await expect(setFreight(china, r1.shipment!.id, { freightCost: "100", freightCurrency: "RMB" })).rejects.toThrow(ForbiddenError);
    await setFreight(admin, r1.shipment!.id, { freightCost: "100", freightCurrency: "RMB", chargeableWeightKg: "4" });
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: r1.shipment!.id } });
    expect(s.freightCostBdt?.toString()).toBe("1700");
    const p1 = await prisma.receiving.findUniqueOrThrow({ where: { id: r1.receiving.id }, include: { lines: true } });
    const p2 = await prisma.receiving.findUniqueOrThrow({ where: { id: r2.receiving.id } });
    expect([p1.freightShareBdt?.toString(), p2.freightShareBdt?.toString()]).toEqual(["1275", "425"]);
    // 4 shoes + 2 bags share 1275 by quantity
    expect(p1.lines.map((l) => l.freightShareBdt?.toString()).sort()).toEqual(["425", "850"]);
  });

  it("repacks parcels into one and updates shipment totals", async () => {
    const a = await purchased(4, "AIR", "R1");
    const b = await purchased(1, "AIR", "R2");
    const recv = async (x: typeof a) =>
      receiveParcel(china, { supplierOrderId: x.so.id, condition: "OK", grossWeightKg: "2", cartons: [carton], shippingMethod: "AIR", shipmentId: "auto", lines: x.pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) }, NOW);
    const r1 = await recv(a);
    const r2 = await recv(b);
    const res = await repack(china, [r1.receiving.id, r2.receiving.id], { cartons: [{ lengthCm: "60", widthCm: "50", heightCm: "40" }], grossWeightKg: "3.6", shipmentId: "auto" }, NOW);
    expect(res.shipment?.itemCount).toBe(1);
    expect(res.shipment?.grossWeightKg.toString()).toBe("3.6");
    expect(res.shipment?.cbm.toString()).toBe("0.12");
    expect(await prisma.receivingLine.count({ where: { receivingId: res.receiving.id } })).toBe(4);
    expect((await prisma.receiving.findUniqueOrThrow({ where: { id: r1.receiving.id } })).status).toBe("REPACKED");
  });
});
