import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, CN_TZ, addDays, isoWeek, toYmd, today } from "@/lib/dates";
import type { ShipmentStatus, ShippingMethod } from "@/generated/prisma/client";
import { createRequest, recordPayment } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { receiveParcel, repack } from "@/server/receiving";
import { acceptingShipments, defaultDates, moveReceiving, shipmentCode } from "@/server/shipments";
import { assignShippingOrder, createShippingOrder, receiveShippingChina } from "@/server/shipping-orders";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const carton = { lengthCm: "50", widthCm: "40", heightCm: "30" };
const STATUSES: ShipmentStatus[] = ["UPCOMING", "OPEN", "CLOSED", "DEPARTED", "IN_TRANSIT", "ARRIVED_BD", "CUSTOMS_CLEARED", "COMPLETED"];

/** One Air and one Sea shipment in every status, in weeks whose cut-off is still ahead. */
async function shipments() {
  const out: Record<string, { id: string; code: string }> = {};
  let n = 0;
  for (const status of STATUSES) {
    n += 1;
    const { year, week } = isoWeek(addDays(today(CN_TZ), 7 * n));
    for (const method of ["AIR", "SEA"] as ShippingMethod[]) {
      out[`${method}-${status}`] = await prisma.shipment.create({ data: { code: shipmentCode(year, week, method), year, weekNumber: week, method, status, ...defaultDates(year, week, method) } });
    }
  }
  return out;
}

/** An AIR Buy for Me line bought and shipped by the supplier, ready to receive. */
async function boughtAir() {
  const { order } = await createRequest(cs, { customer: { name: "R", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
  await quoteAndApprove(order.id, "10", "999");
  await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "100", method: "CASH" });
  const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
  const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })) });
  await markShippedBySupplier(china, so.id, { courierName: "YTO", trackingNo: `YT${so.number}` });
  return { so, pls: await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id } }) };
}

const receiveInput = (so: { id: string }, pls: { id: string; quantity: number }[], shipmentId: string | null, shippingMethod: ShippingMethod = "AIR") => ({
  supplierOrderId: so.id,
  condition: "OK" as const,
  grossWeightKg: "2",
  cartons: [carton],
  shippingMethod,
  shipmentId,
  lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })),
});

describe("Shipment picker: only open / upcoming shipments of the same method", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("lists only open / upcoming Air for Air and Sea for Sea", async () => {
    const s = await shipments();
    const codes = async (m: ShippingMethod) => (await acceptingShipments(m)).map((x) => x.code).sort();
    expect(await codes("AIR")).toEqual([s["AIR-UPCOMING"].code, s["AIR-OPEN"].code].sort());
    expect(await codes("SEA")).toEqual([s["SEA-UPCOMING"].code, s["SEA-OPEN"].code].sort());
  });

  it("the server refuses the other method or a closed / departed / … shipment on every assignment path", async () => {
    const s = await shipments();
    // Receiving a parcel: refused, and nothing is saved
    const { so, pls } = await boughtAir();
    await expect(receiveParcel(china, receiveInput(so, pls, s["SEA-OPEN"].id))).rejects.toThrow(/is a sea shipment; this parcel ships by air/);
    for (const st of STATUSES.slice(2)) await expect(receiveParcel(china, receiveInput(so, pls, s[`AIR-${st}`].id))).rejects.toThrow(/only open or upcoming shipments/);
    expect(await prisma.receiving.count()).toBe(0);
    const ok = await receiveParcel(china, receiveInput(so, pls, s["AIR-UPCOMING"].id));
    expect(ok.shipment?.id).toBe(s["AIR-UPCOMING"].id);

    // Moving a parcel
    await expect(moveReceiving(china, ok.receiving.id, s["SEA-UPCOMING"].id)).rejects.toThrow(/sea shipment/);
    await expect(moveReceiving(china, ok.receiving.id, s["AIR-CLOSED"].id)).rejects.toThrow(/closed – only open or upcoming/);
    await expect(moveReceiving(cs, ok.receiving.id, s["AIR-OPEN"].id)).rejects.toThrow(ForbiddenError);
    await moveReceiving(china, ok.receiving.id, s["AIR-OPEN"].id);
    expect((await prisma.receiving.findUniqueOrThrow({ where: { id: ok.receiving.id } })).shipmentId).toBe(s["AIR-OPEN"].id);

    // Repack into a shipment
    const b = await boughtAir();
    const two = await receiveParcel(china, receiveInput(b.so, b.pls, null));
    await expect(repack(china, [ok.receiving.id, two.receiving.id], { cartons: [carton], grossWeightKg: "4", shipmentId: s["SEA-OPEN"].id })).rejects.toThrow(/sea shipment/);

    // Ship for Me order (Sea)
    const sfm = await createShippingOrder(cs, { customer: { name: "K", phone: "01911000000", address: "x" }, shippingMethod: "SEA", qaRequested: false, items: [{ productName: "Shoes", quantity: 1 }] });
    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: sfm.id } });
    await receiveShippingChina(china, sfm.id, { items: [{ itemId: item.id, quantityReceived: 1, condition: "OK" }], cartons: [{ ...carton, grossWeightKg: "3" }] });
    await expect(assignShippingOrder(china, sfm.id, s["AIR-OPEN"].id)).rejects.toThrow(/air shipment; this order ships by sea/);
    await expect(assignShippingOrder(china, sfm.id, s["SEA-DEPARTED"].id)).rejects.toThrow(/departed – only open or upcoming/);
    expect((await assignShippingOrder(china, sfm.id, s["SEA-OPEN"].id)).shipment.id).toBe(s["SEA-OPEN"].id);
  });
});
