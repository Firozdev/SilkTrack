import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { createPortalRequest, recordPayment } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { receiveParcel } from "@/server/receiving";
import { setShipmentStatus } from "@/server/shipments";
import { advanceOrder, bulkMoveShipmentOrders, moveOrderBack } from "@/server/order-stages";
import { portalOrder } from "@/server/portal";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
let phone = 0;

/** A portal customer's Buy for Me order, bought and received into this week's Air shipment. */
async function orderInShipment(product = "Lamp") {
  phone += 1;
  const acc = await signUp({ name: `K${phone}`, phone: `0171100000${phone}`, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  const { order } = await createPortalRequest(a.customerId!, { shippingMethod: "AIR", lines: [{ productName: product, quantity: 1, links: [] }] }, { accountId: a.id });
  await quoteAndApprove(order.id, "10", "1000");
  await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "400", method: "CASH" });
  const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
  const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })) });
  await markShippedBySupplier(china, so.id, { courierName: "YTO", trackingNo: `YT${so.number}` });
  const pls = await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id } });
  const r = await receiveParcel(china, { supplierOrderId: so.id, condition: "OK", grossWeightKg: "2", cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30" }], shippingMethod: "AIR", shipmentId: "auto", lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) });
  return { order, accountId: a.id, customerId: a.customerId!, shipmentId: r.shipment!.id };
}
const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

describe("Buy for Me – Bangladesh stages", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("an order goes through every step to Delivered: timeline, audit and customer notified each time", async () => {
    const k = await orderInShipment();
    expect(await status(k.order.id)).toBe("IN_SHIPMENT");
    await expect(advanceOrder(cs, k.order.id)).rejects.toThrow(ForbiddenError);
    await expect(advanceOrder(china, k.order.id)).rejects.toThrow(ForbiddenError);

    const steps = ["ARRIVED_BD", "CUSTOMS_CLEARED", "INVOICE_SHARED", "PAYMENT_COLLECTED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"];
    for (const st of steps) {
      // A stale page (expected status) is refused instead of skipping a step
      if (st === "CUSTOMS_CLEARED") await expect(advanceOrder(admin, k.order.id, "IN_SHIPMENT")).rejects.toThrow(/refresh the page/);
      expect(await advanceOrder(admin, k.order.id)).toBe(st);
      expect(await status(k.order.id)).toBe(st);
    }
    await expect(advanceOrder(admin, k.order.id)).rejects.toThrow(/Already delivered/);

    // Timeline: one step per status with date/time and the Admin who did it – staff and customer views
    const events = await prisma.trackingEvent.findMany({ where: { orderLine: { orderId: k.order.id }, status: { in: steps as never } }, orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => e.status)).toEqual(steps);
    expect(events.every((e) => e.createdById === admin.id && e.occurredAt instanceof Date)).toBe(true);
    const p = (await portalOrder(k.customerId, k.order.id))!;
    expect(p.lines[0].trackingEvents.map((e) => e.status).filter((s) => s && steps.includes(s))).toEqual(steps);

    // Audit log
    const audit = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: k.order.id, field: "status" }, orderBy: { createdAt: "asc" } });
    expect(audit.slice(-steps.length).map((a) => [a.newValue, a.userId])).toEqual(steps.map((s) => [s, admin.id]));

    // Customer notified for each step (portal bell)
    const notes = await prisma.notification.findMany({ where: { portalAccountId: k.accountId, orderId: k.order.id }, select: { type: true } });
    for (const t of ["ARRIVED_BD", "CUSTOMS_CLEARED", "INVOICE_READY", "PAYMENT_COLLECTED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]) expect(notes.map((n) => n.type), t).toContain(t);
    const inv = await prisma.notification.findFirstOrThrow({ where: { portalAccountId: k.accountId, type: "INVOICE_READY" } });
    expect(inv.body).toMatch(/^Balance due ৳[\d,.]+\. Open the order to see the bill and pay\.$/); // quote total − ৳400 advance
  });

  it("move back one step needs a reason, which is logged", async () => {
    const k = await orderInShipment();
    await advanceOrder(admin, k.order.id); // Bangladesh received
    await advanceOrder(admin, k.order.id); // Customs clearance
    await expect(moveOrderBack(admin, k.order.id, " ")).rejects.toThrow(/reason/);
    await expect(moveOrderBack(cs, k.order.id, "Wrong order")).rejects.toThrow(ForbiddenError);
    expect(await moveOrderBack(admin, k.order.id, "Clicked the wrong order")).toBe("ARRIVED_BD");
    expect(await status(k.order.id)).toBe("ARRIVED_BD");
    const ev = await prisma.trackingEvent.findFirstOrThrow({ where: { orderLine: { orderId: k.order.id } }, orderBy: { occurredAt: "desc" } });
    expect([ev.status, ev.message, ev.createdById]).toEqual(["ARRIVED_BD", "Moved back to Bangladesh received – reason: Clicked the wrong order", admin.id]);
    expect(await prisma.auditLog.count({ where: { entityType: "Order", entityId: k.order.id, oldValue: { equals: "CUSTOMS_CLEARED" }, newValue: { equals: "ARRIVED_BD" } } })).toBe(1);
    // Before Bangladesh received there is nothing to move back
    const k2 = await orderInShipment("Bag");
    await expect(moveOrderBack(admin, k2.order.id, "x x x")).rejects.toThrow(/Only Bangladesh stages/);
  });

  it("whole shipment: arrival / customs from the shipment, bulk moves with the payment rule", async () => {
    const a = await orderInShipment("Lamp");
    const b = await orderInShipment("Bag");
    expect(b.shipmentId).toBe(a.shipmentId);
    for (const st of ["CLOSED", "DEPARTED", "ARRIVED_BD"] as const) await setShipmentStatus(admin, a.shipmentId, st);
    expect([await status(a.order.id), await status(b.order.id)]).toEqual(["ARRIVED_BD", "ARRIVED_BD"]);
    await setShipmentStatus(admin, a.shipmentId, "CUSTOMS_CLEARED");
    expect([await status(a.order.id), await status(b.order.id)]).toEqual(["CUSTOMS_CLEARED", "CUSTOMS_CLEARED"]);

    await expect(bulkMoveShipmentOrders(cs, a.shipmentId, "INVOICE_SHARED")).rejects.toThrow(ForbiddenError);
    expect(await bulkMoveShipmentOrders(admin, a.shipmentId, "INVOICE_SHARED")).toEqual({ moved: ["REQ-000001", "REQ-000002"], skipped: [] });
    await advanceOrder(admin, b.order.id); // B: payment collected
    const r = await bulkMoveShipmentOrders(admin, a.shipmentId, "READY_FOR_DELIVERY");
    expect(r).toEqual({ moved: ["REQ-000002"], skipped: [{ ref: "REQ-000001", why: "customer payment not collected yet" }] });
    expect([await status(a.order.id), await status(b.order.id)]).toEqual(["INVOICE_SHARED", "READY_FOR_DELIVERY"]);
    expect((await bulkMoveShipmentOrders(admin, a.shipmentId, "CUSTOMS_CLEARED")).skipped.map((x) => x.why)).toEqual(["already final invoice prepared & shared with customer", "already ready for home delivery"]);
    const ev = await prisma.trackingEvent.findFirstOrThrow({ where: { orderLine: { orderId: b.order.id }, status: "READY_FOR_DELIVERY" } });
    expect([ev.createdById, ev.message.endsWith(" – " + (await prisma.shipment.findUniqueOrThrow({ where: { id: a.shipmentId } })).code)]).toEqual([admin.id, true]);
  });
});
