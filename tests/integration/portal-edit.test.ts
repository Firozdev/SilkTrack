import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { cancelPortalRequest, createPortalRequest, sendToChina, updatePortalRequest } from "@/server/requests";
import { saveQuotation } from "@/server/estimates";
import { cancelPortalShippingOrder, createPortalShippingOrder, receiveShippingChina, updatePortalShippingOrder } from "@/server/shipping-orders";
import { saveItemFiles } from "@/server/line-files";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

async function customer(phone: string) {
  const acc = await signUp({ name: phone, phone, password: "secret-pass-1", address: "x" });
  await approveAccount(cs, acc.id, "new");
  const a = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  return { accountId: a.id, customerId: a.customerId! };
}

describe("Customer edits and cancels in the portal", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.25", admin.id);
  });

  it("request: change, remove and add products until China starts quoting", async () => {
    const k = await customer("01711000000");
    const other = await customer("01811000000");
    const { order } = await createPortalRequest(k.customerId, {
      shippingMethod: "AIR",
      lines: [
        { productName: "Lamp", quantity: 1, links: ["https://detail.1688.com/offer/1.html"] },
        { productName: "Shade", quantity: 2, links: [] },
      ],
    });
    const [lamp, shade] = order.lines;
    const edit = {
      shippingMethod: "SEA" as const,
      customerNotes: "Blue please",
      lines: [
        { id: lamp.id, productName: "Lamp XL", quantity: 3, links: ["https://detail.1688.com/offer/2.html"] },
        { productName: "Bulb", quantity: 10, links: [] },
      ],
    };
    await expect(updatePortalRequest(other.customerId, order.id, edit)).rejects.toThrow(/Not found/);
    // can't smuggle in another order's line
    const { order: otherOrder } = await createPortalRequest(other.customerId, { shippingMethod: "AIR", lines: [{ productName: "X", quantity: 1, links: [] }] });
    await expect(updatePortalRequest(k.customerId, order.id, { ...edit, lines: [{ id: otherOrder.lines[0].id, productName: "hack", quantity: 1, links: [] }] })).rejects.toThrow(/Not found/);

    const ids = await updatePortalRequest(k.customerId, order.id, edit);
    expect(ids[0]).toBe(lamp.id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: { orderBy: { lineNo: "asc" }, include: { links: true, trackingEvents: true } } } });
    expect([o.shippingMethod, o.customerNotes]).toEqual(["SEA", "Blue please"]);
    expect(o.lines.map((l) => [l.productName, l.quantity, l.lineNo])).toEqual([
      ["Lamp XL", 3, 1],
      ["Bulb", 10, 3],
    ]);
    expect(o.lines[0].links.map((l) => l.url)).toEqual(["https://detail.1688.com/offer/2.html"]);
    expect(o.lines[1].trackingEvents[0].message).toMatch(/Added by the customer/);
    expect(await prisma.orderLine.count({ where: { id: shade.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: "PORTAL_REQUEST_EDITED", userId: cs.id } })).toBe(1);

    // Sent to China, no quote yet → still editable, and China is told
    await sendToChina(cs, order.id);
    await updatePortalRequest(k.customerId, order.id, { ...edit, lines: [{ id: lamp.id, productName: "Lamp XL", quantity: 4, links: [] }] });
    expect(await prisma.notification.count({ where: { type: "PORTAL_REQUEST_EDITED", userId: china.id } })).toBe(1);

    // China starts the quotation → locked
    await saveQuotation(china, order.id, { shippingMethod: "SEA", shippingRatePerCbmRmb: "1000", validUntil: new Date("2099-01-01T00:00:00Z"), lines: [{ orderLineId: lamp.id, unitPriceRmb: "10" }] });
    await expect(updatePortalRequest(k.customerId, order.id, edit)).rejects.toThrow(/can't be changed any more/);
    await expect(cancelPortalRequest(k.customerId, order.id)).rejects.toThrow(/can't be changed any more/);
  });

  it("request: customer cancels while it is new", async () => {
    const k = await customer("01711000000");
    const { order } = await createPortalRequest(k.customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] });
    await cancelPortalRequest(k.customerId, order.id, "Found it locally");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect([o.requestStatus, o.status, o.lines[0].status]).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    expect(await prisma.notification.count({ where: { type: "PORTAL_REQUEST_CANCELLED", userId: cs.id } })).toBe(1);
    await expect(cancelPortalRequest(k.customerId, order.id)).rejects.toThrow(/can't be changed/);
  });

  it("shipping order: edit items (renumbered, files on the right item) until received in China", async () => {
    const k = await customer("01711000000");
    const so = await createPortalShippingOrder(k.customerId, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }, { productName: "Bags", quantity: 1 }] });
    const [shoes, bags] = await prisma.shippingOrderItem.findMany({ where: { shippingOrderId: so.id }, orderBy: { lineNo: "asc" } });
    const rows = [
      { _i: "4", id: bags.id, productName: "Bags", quantity: 3, trackingNo: "SF123" },
      { _i: "7", productName: "Belts", quantity: 5 },
    ];
    await updatePortalShippingOrder(k.customerId, so.id, { shippingMethod: "SEA", qaRequested: true, items: rows });
    const fd = new FormData();
    fd.append("p.7.files", new File(["%PDF-1.4"], "belts.pdf", { type: "application/pdf" }));
    await saveItemFiles(fd, rows, so.id, { accountId: k.accountId });

    const s = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: { orderBy: { lineNo: "asc" }, include: { attachments: true } } } });
    expect([s.shippingMethod, s.qaRequested]).toEqual(["SEA", true]);
    expect(s.items.map((i) => [i.lineNo, i.productName, i.quantity, i.trackingNo, i.attachments.map((a) => a.fileName)])).toEqual([
      [1, "Bags", 3, "SF123", []],
      [2, "Belts", 5, null, ["belts.pdf"]],
    ]);
    expect(await prisma.shippingOrderItem.count({ where: { id: shoes.id } })).toBe(0);

    await receiveShippingChina(china, so.id, { items: s.items.map((i) => ({ itemId: i.id, quantityReceived: i.quantity, condition: "OK" as const })), cartons: [{ lengthCm: "10", widthCm: "10", heightCm: "10", grossWeightKg: "1" }] });
    await expect(updatePortalShippingOrder(k.customerId, so.id, { shippingMethod: "AIR", qaRequested: false, items: rows })).rejects.toThrow(/can't be changed any more/);
    await expect(cancelPortalShippingOrder(k.customerId, so.id)).rejects.toThrow(/can't be changed any more/);
  });

  it("shipping order: customer cancels before it is received", async () => {
    const k = await customer("01711000000");
    const other = await customer("01811000000");
    const so = await createPortalShippingOrder(k.customerId, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] });
    await expect(cancelPortalShippingOrder(other.customerId, so.id)).rejects.toThrow(/not found/);
    await cancelPortalShippingOrder(k.customerId, so.id, "Supplier refunded");
    expect((await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("CANCELLED");
  });
});
