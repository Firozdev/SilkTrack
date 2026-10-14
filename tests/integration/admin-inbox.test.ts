import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { adminInbox } from "@/server/dashboard";
import { approveAccount, signUp } from "@/server/portal-auth";
import { createPortalRequest, createRequest, sendToChina } from "@/server/requests";
import { saveQuotation, submitQuotation } from "@/server/estimates";
import { createPortalShippingOrder, createShippingOrder, receiveShippingChina } from "@/server/shipping-orders";
import { rejectSubmission } from "@/server/payment-submissions";
import { updateIssue } from "@/server/issues";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

const panel = async (key: string) => (await adminInbox(admin)).find((p) => p.key === key)!;

async function portalCustomer(phone: string) {
  const acc = await signUp({ name: "Karim", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  return { accountId: a.id, customerId: a.customerId! };
}

describe("Admin dashboard: New Requests", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("only Admin can load it", async () => {
    await expect(adminInbox(cs)).rejects.toThrow(ForbiddenError);
    await expect(adminInbox(china)).rejects.toThrow(ForbiddenError);
  });

  it("new requests go straight to China and stay in Buy for Me until China submits the quotation", async () => {
    const k = await portalCustomer("01711000000");
    const { order: portal } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] });
    const { order: staff } = await createRequest(cs, { customer: { name: "Rahim", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
    expect(portal.requestStatus).toBe("SENT_TO_CHINA");
    expect(staff.requestStatus).toBe("SENT_TO_CHINA");
    expect(await prisma.notification.count({ where: { type: "BUY_REQUEST_NEW", userId: china.id } })).toBe(2);
    await expect(sendToChina(cs, staff.id)).rejects.toThrow(/Only new requests/);

    let p = await panel("buy");
    expect(p.count).toBe(2);
    expect(p.items.map((i) => [i.no, i.customer, i.tag, i.href])).toEqual([
      ["REQ-000002", "Rahim", "Staff", `/requests/${staff.id}`],
      ["REQ-000001", "Karim", "Portal", `/requests/${portal.id}`],
    ]);

    // A draft quotation doesn't count as actioned; submitting it does.
    const e = await saveQuotation(china, staff.id, { shippingMethod: "AIR", shippingRatePerKgRmb: "40", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: staff.lines[0].id, unitPriceRmb: "10" }] });
    expect((await panel("buy")).count).toBe(2);
    await submitQuotation(china, e.id);
    p = await panel("buy");
    expect(p.items.map((i) => i.id)).toEqual([portal.id]);
  });

  it("Ship for Me orders stay until the goods are received in China", async () => {
    const k = await portalCustomer("01711000000");
    const portal = await createPortalShippingOrder(k.customerId, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] });
    const staff = await createShippingOrder(cs, { customer: { name: "Rahim", phone: "01811000000", address: "x" }, shippingMethod: "SEA", qaRequested: false, items: [{ productName: "Chairs", quantity: 4 }] });

    let p = await panel("ship");
    expect(p.count).toBe(2);
    expect(p.items.find((i) => i.id === portal.id)).toMatchObject({ no: "SHO-000001", customer: "Karim", tag: "Portal", href: `/shipping-orders/${portal.id}` });

    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: staff.id } });
    await receiveShippingChina(china, staff.id, { items: [{ itemId: item.id, quantityReceived: 4, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "12.5" }] });
    p = await panel("ship");
    expect(p.items.map((i) => i.id)).toEqual([portal.id]);
  });

  it("customer payments stay until confirmed or rejected", async () => {
    const k = await portalCustomer("01711000000");
    const so = await createPortalShippingOrder(k.customerId, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] });
    const s = await prisma.paymentSubmission.create({
      data: { customerId: k.customerId, accountId: k.accountId, shippingOrderId: so.id, amountBdt: "500", method: "BKASH", reference: "TRX12345", paidAt: new Date() },
    });

    let p = await panel("payments");
    expect(p.count).toBe(1);
    expect(p.items[0]).toMatchObject({ no: "PS-000001", customer: "Karim", href: `/payments-to-verify?id=${s.id}` });

    await rejectSubmission(admin, s.id, "Not on the statement");
    p = await panel("payments");
    expect([p.count, p.items.length]).toEqual([0, 0]);
  });

  it("issues stay while open or in progress", async () => {
    const { order } = await createRequest(cs, { customer: { name: "Rahim", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
    const issue = await prisma.issue.create({ data: { type: "DAMAGED", source: "CHINA_RECEIVING", orderId: order.id, description: "Box crushed", reportedById: china.id } });

    let p = await panel("issues");
    expect(p.items[0]).toMatchObject({ no: "ISS-000001", customer: "Rahim", tag: "DAMAGED", href: `/issues?id=${issue.id}` });

    await updateIssue(admin, issue.id, { status: "IN_PROGRESS" });
    expect((await panel("issues")).count).toBe(1);
    await updateIssue(admin, issue.id, { status: "RESOLVED", resolution: "Supplier sent a new one" });
    p = await panel("issues");
    expect(p.count).toBe(0);
  });
});
