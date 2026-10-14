import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { createPortalRequest, createRequest, recordPayment, updatePortalRequest } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { receiveParcel } from "@/server/receiving";
import { moveReceiving, suggestShipment } from "@/server/shipments";
import { qaTodo, recordOrderQa } from "@/server/order-qa";
import { portalOrder } from "@/server/portal";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000001249444154789c63907358ff1f1933a00b00000a491061fb654d210000000049454e44ae426082", "hex");
const carton = { lengthCm: "50", widthCm: "40", heightCm: "30" };

async function portalCustomer() {
  const acc = await signUp({ name: "Karim", phone: "01711000000", password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  return { accountId: a.id, customerId: a.customerId! };
}

/** Quote → approve → advance → buy; returns the purchase line to receive. */
async function bought(orderId: string) {
  await quoteAndApprove(orderId, "10", "999");
  await recordPayment(cs, orderId, { type: "ADVANCE", amountBdt: "100", method: "CASH" });
  const lines = await prisma.orderLine.findMany({ where: { orderId } });
  const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })) });
  await markShippedBySupplier(china, so.id, { courierName: "YTO", trackingNo: `YT${orderId.slice(-6)}` });
  const pls = await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id } });
  return { so, pls };
}

const receive = (so: { id: string }, pls: { id: string; quantity: number }[]) =>
  receiveParcel(china, { supplierOrderId: so.id, condition: "OK", grossWeightKg: "2", cartons: [carton], shippingMethod: "AIR", shipmentId: "auto", lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) });

describe("Buy for Me – optional QA test", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("QA ticked: task after receiving, shipping waits, the result notifies the customer and flags Admin on a fail", async () => {
    const k = await portalCustomer();
    const { order } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", qaRequested: true, lines: [{ productName: "Lamp", quantity: 2, links: [] }] }, { accountId: k.accountId });
    expect(order.qaRequested).toBe(true);
    // The customer can still change it while editing (until China quotes)
    await updatePortalRequest(k.customerId, order.id, { shippingMethod: "AIR", qaRequested: false, lines: [{ id: order.lines[0].id, productName: "Lamp", quantity: 2, links: [] }] });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).qaRequested).toBe(false);
    await updatePortalRequest(k.customerId, order.id, { shippingMethod: "AIR", qaRequested: true, lines: [{ id: order.lines[0].id, productName: "Lamp", quantity: 2, links: [] }] });

    const { so, pls } = await bought(order.id);
    await expect(recordOrderQa(china, order.id, { result: "PASSED" })).rejects.toThrow(/Receive the goods/); // not received yet
    expect(await qaTodo()).toHaveLength(0);

    // Received: not put in a shipment, QA task for China (once)
    const r = await receive(so, pls);
    expect(r.shipment).toBeNull();
    expect(r.warning).toMatch(/QA test for REQ-000001/);
    expect((await qaTodo()).map((o) => o.id)).toEqual([order.id]);
    expect(await prisma.notification.count({ where: { type: "QA_REQUESTED", userId: china.id, orderId: order.id } })).toBe(1);
    const week = await prisma.$transaction((tx) => suggestShipment(tx, "AIR"));
    await expect(moveReceiving(china, r.receiving.id, week.id)).rejects.toThrow(/Record the QA test for REQ-000001 before shipping/);

    // Only China / Admin record it
    await expect(recordOrderQa(cs, order.id, { result: "PASSED" })).rejects.toThrow(ForbiddenError);
    await recordOrderQa(china, order.id, { result: "FAILED", notes: "Two lamps scratched" }, [new File([new Uint8Array(PNG)], "qa.png", { type: "image/png" })]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([o.qaResult, o.qaNotes, o.qaById]).toEqual(["FAILED", "Two lamps scratched", china.id]);
    expect(await qaTodo()).toHaveLength(0);

    // Customer notified (link to their order); Admin flagged
    const forCustomer = await prisma.notification.findFirstOrThrow({ where: { type: "QA_FAILED", portalAccountId: k.accountId } });
    expect(forCustomer.title).toBe("REQ-000001 QA test failed");
    expect(forCustomer.link).toBe(`/portal/requests/${order.id}`);
    expect(await prisma.notification.count({ where: { type: "QA_FAILED", userId: admin.id } })).toBe(1);

    // The customer sees result, notes and the photo
    const p = (await portalOrder(k.customerId, order.id))!;
    expect([p.qaRequested, p.qaResult, p.qaNotes]).toEqual([true, "FAILED", "Two lamps scratched"]);
    expect(p.attachments.filter((a) => a.kind === "QA_PHOTO").map((a) => a.fileName)).toEqual(["qa.png"]);

    // Corrected to a pass, then shipping is allowed; after that the result is locked
    await recordOrderQa(admin, order.id, { result: "PASSED", notes: "Replaced by supplier" });
    expect(await prisma.notification.count({ where: { type: "QA_PASSED", portalAccountId: k.accountId } })).toBe(1);
    await moveReceiving(china, r.receiving.id, week.id);
    await expect(recordOrderQa(china, order.id, { result: "FAILED" })).rejects.toThrow(/already in a shipment/);
  });

  it("QA not ticked: no task, ships straight away", async () => {
    const { order } = await createRequest(cs, { customer: { name: "R", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
    expect(order.qaRequested).toBe(false);
    const { so, pls } = await bought(order.id);
    const r = await receive(so, pls);
    expect(r.shipment).not.toBeNull();
    expect(await qaTodo()).toHaveLength(0);
    expect(await prisma.notification.count({ where: { type: "QA_REQUESTED" } })).toBe(0);
    await expect(recordOrderQa(china, order.id, { result: "PASSED" })).rejects.toThrow(/did not ask for a QA test/);
  });
});
