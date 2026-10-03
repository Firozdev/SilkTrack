import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import {
  addComment,
  cancelOrder,
  createRequest,
  isReleasedForPurchase,
  recordPayment,
  sendToChina,
  setHold,
  type RequestInput,
} from "@/server/requests";
import { makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";
import { markCustomerApproved } from "@/server/requests";
import { BD_TZ, toYmd, today } from "@/lib/dates";

const customer = { name: "Karim", phone: "01711-000000", address: "House 1, Road 2", district: "Dhaka" };
const base = (over: Partial<RequestInput> = {}): RequestInput => ({
  customer,
  shippingMethod: "AIR",
  lines: [
    { productName: "Phone case", quantity: 2, links: ["https://item.taobao.com/item.htm?id=111&spm=x"] },
    { productName: "Cable", quantity: 3, links: [] },
  ],
  ...over,
});

describe("product requests", () => {
  beforeEach(resetDb);

  it("PURCHASE cannot create requests", async () => {
    const p = await makeUser("PURCHASE");
    await expect(createRequest(p, base())).rejects.toThrow(ForbiddenError);
  });

  it("creates order, lines, links, customer and a timeline entry", async () => {
    const cs = await makeUser("CS");
    const { order, suggestedType } = await createRequest(cs, base());
    expect(suggestedType).toBe("SINGLE");
    expect(order.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    const full = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { customer: true, lines: { include: { links: true, trackingEvents: true } } },
    });
    expect(full.customer.code).toBe("C-00001");
    expect(full.customer.phone).toBe("01711000000");
    expect(full.lines[0].links[0].platform).toBe("TAOBAO");
    expect(full.lines[0].trackingEvents).toHaveLength(1);
  });

  it("reuses an existing customer by phone", async () => {
    const cs = await makeUser("CS");
    await createRequest(cs, base());
    await createRequest(cs, base({ lines: [{ productName: "Other", quantity: 1, links: [] }] }));
    expect(await prisma.customer.count()).toBe(1);
  });

  it("suggests BULK by quantity threshold and records an override", async () => {
    const cs = await makeUser("CS");
    const r = await createRequest(cs, base({ lines: [{ productName: "Socks", quantity: 500, links: [] }] }));
    expect(r.suggestedType).toBe("BULK");
    expect(r.order.type).toBe("BULK");
    const r2 = await createRequest(cs, base({ type: "SINGLE", lines: [{ productName: "Hats", quantity: 500, links: [] }] }));
    expect(r2.order.typeOverridden).toBe(true);
  });

  it("blocks duplicate links unless confirmed", async () => {
    const cs = await makeUser("CS");
    const first = await createRequest(cs, base());
    const again = base({ lines: [{ productName: "Same", quantity: 1, links: ["http://m.taobao.com/item.htm?id=111"] }] });
    await expect(createRequest(cs, again)).rejects.toMatchObject({
      links: [expect.objectContaining({ href: `/requests/${first.order.id}` })],
    });
    await expect(createRequest(cs, { ...again, allowDuplicates: true })).resolves.toBeTruthy();
  });

  it("runs quotation → approve → advance → released for purchase", async () => {
    const cs = await makeUser("CS");
    await makeUser("PURCHASE");
    const admin = await makeUser("ADMIN");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
    const { order } = await createRequest(cs, base());
    await sendToChina(cs, order.id);
    expect(await prisma.notification.count({ where: { type: "NEW_REQUEST" } })).toBe(1);
    await expect(markCustomerApproved(cs, order.id)).rejects.toThrow(/quoted/);

    await quoteAndApprove(order.id, "10.50", "500");
    let o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true, lines: true } });
    expect(o.status).toBe("APPROVED");
    expect(o.lines.every((l) => l.status === "APPROVED" && l.quotedUnitPriceRmb?.toString() === "10.5" && l.sellingPriceBdt?.toString() === "500")).toBe(true);
    expect(isReleasedForPurchase(o)).toBe(false);

    await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "300", method: "BKASH", reference: "TX1" });
    o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true, lines: true } });
    expect(isReleasedForPurchase(o)).toBe(true);
    expect(await prisma.notification.count({ where: { type: "READY_TO_PURCHASE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "Order", field: "status" } })).toBeGreaterThanOrEqual(2);
  });

  it("hold and resume restores the derived status", async () => {
    const cs = await makeUser("CS");
    const { order } = await createRequest(cs, base());
    await setHold(cs, order.id, true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("ON_HOLD");
    await setHold(cs, order.id, false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REQUESTED");
  });

  it("cancels an order and all lines", async () => {
    const cs = await makeUser("CS");
    const { order } = await createRequest(cs, base());
    await cancelOrder(cs, order.id, "customer changed mind");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    expect(o.status).toBe("CANCELLED");
    expect(o.requestStatus).toBe("CANCELLED");
    expect(o.lines.every((l) => l.status === "CANCELLED")).toBe(true);
  });

  it("comments notify the other team", async () => {
    const cs = await makeUser("CS");
    const p = await makeUser("PURCHASE");
    const { order } = await createRequest(cs, base());
    await addComment(p, order.id, "Price went up 10%");
    const n = await prisma.notification.findMany({ where: { type: "COMMENT" } });
    expect(n.map((x) => x.userId)).toEqual([cs.id]);
  });
});
