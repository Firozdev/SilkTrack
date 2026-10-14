import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, isoWeek, isoWeekStart, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { createRequest, recordPayment } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { receiveParcel } from "@/server/receiving";
import { setFreight, setShipmentStatus, updateShipmentDetails } from "@/server/shipments";
import { assignShippingOrder, createPortalShippingOrder, receiveShippingChina } from "@/server/shipping-orders";
import { portalShipments } from "@/server/portal";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function customer(phone: string) {
  const acc = await signUp({ name: "Karim", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  return (await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).customerId!;
}

describe("Customer portal – Shipment box", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("Ship for Me: not assigned → the shipment's code and dates, live after Admin edits", async () => {
    const k = await customer("01711000000");
    const other = await customer("01722000000");
    const so = await createPortalShippingOrder(k, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] });
    expect(await portalShipments(k, { shippingOrderId: so.id })).toEqual({ shipments: [], unassigned: ["Shoes"] });

    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    await receiveShippingChina(china, so.id, { items: [{ itemId: item.id, quantityReceived: 2, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "5" }] });
    const { shipment } = await assignShippingOrder(china, so.id, "auto");

    let box = (await portalShipments(k, { shippingOrderId: so.id }))!;
    expect(box.shipments).toHaveLength(1);
    const s = box.shipments[0];
    expect(s.code).toBe(shipment.code);
    expect(s.startDate).toEqual(isoWeekStart(shipment.year, shipment.weekNumber));
    expect(s.departure).toEqual({ date: shipment.plannedDepartureDate, planned: true });
    expect(s.bdReceive).toEqual({ date: shipment.etaBd, actual: false });

    // Admin changes the dates → the customer sees them on the next load.
    await updateShipmentDetails(admin, shipment.id, { cutoffDate: shipment.cutoffDate, plannedDepartureDate: day("2099-02-01"), etaBd: day("2099-02-09"), forwarder: "Secret Cargo Ltd" });
    await setFreight(admin, shipment.id, { freightCost: "12345", freightCurrency: "BDT" });
    box = (await portalShipments(k, { shippingOrderId: so.id }))!;
    expect(box.shipments[0].departure).toEqual({ date: day("2099-02-01"), planned: true });
    expect(box.shipments[0].bdReceive).toEqual({ date: day("2099-02-09"), actual: false });

    // Nothing internal leaks: no freight, forwarder, tracking or totals.
    const raw = JSON.stringify(box);
    for (const secret of ["Secret Cargo", "12345", "freight", "forwarder", "masterTracking", "grossWeight", "itemCount"]) expect(raw).not.toContain(secret);

    // Departed / arrived → actual dates.
    await setShipmentStatus(admin, shipment.id, "CLOSED");
    await setShipmentStatus(admin, shipment.id, "DEPARTED");
    await setShipmentStatus(admin, shipment.id, "ARRIVED_BD");
    const after = (await portalShipments(k, { shippingOrderId: so.id }))!.shipments[0];
    expect(after.departure.planned).toBe(false);
    expect(after.bdReceive.actual).toBe(true);

    // Another customer can't read it.
    expect(await portalShipments(other, { shippingOrderId: so.id })).toBeNull();
  });

  it("Buy for Me: products in a shipment are listed with it; the rest are not assigned yet", async () => {
    const { order } = await createRequest(cs, {
      customer: { name: "Rahim", phone: "01811000000", address: "x" },
      shippingMethod: "AIR",
      lines: [
        { productName: "Shoe", quantity: 2, links: [] },
        { productName: "Bag", quantity: 1, links: [] },
      ],
    });
    expect(await portalShipments(order.customerId, { orderId: order.id })).toEqual({ shipments: [], unassigned: ["Shoe", "Bag"] });

    await quoteAndApprove(order.id, "10", "999");
    await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "100", method: "CASH" });
    const sup = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: order.lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })) });
    await markShippedBySupplier(china, sup.id, { courierName: "YTO", trackingNo: "YT1" });
    const pls = await prisma.purchaseLine.findMany({ where: { supplierOrderId: sup.id }, include: { orderLine: true } });
    const shoe = pls.find((p) => p.orderLine.productName === "Shoe")!;
    // Only the shoes arrived so far; they go into this week's shipment.
    const r = await receiveParcel(china, { supplierOrderId: sup.id, condition: "OK", grossWeightKg: "2", cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30" }], shippingMethod: "AIR", shipmentId: "auto", lines: [{ purchaseLineId: shoe.id, quantityReceived: 2, condition: "OK" }] });

    const box = (await portalShipments(order.customerId, { orderId: order.id }))!;
    expect(box.shipments.map((s) => [s.code, s.products])).toEqual([[r.shipment!.code, ["Shoe"]]]);
    expect(box.unassigned).toEqual(["Bag"]);
    const { year, week } = isoWeek(today(BD_TZ));
    expect(box.shipments[0].startDate.getTime()).toBeGreaterThanOrEqual(isoWeekStart(year, week).getTime());

    const someoneElse = await customer("01733000000");
    expect(await portalShipments(someoneElse, { orderId: order.id })).toBeNull();
  });
});
