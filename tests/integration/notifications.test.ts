import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { RULES } from "@/lib/notifications/rules";
import { TEMPLATES, TYPE_LABEL } from "@/lib/notifications/templates";
import { acceptInvite, approveAccount, signUp } from "@/server/portal-auth";
import { assignAgent, createAgent } from "@/server/agents";
import { placedBy } from "@/server/portal-access";
import { createPortalShippingOrder, createShippingOrder, assignShippingOrder, receiveShippingChina, recordQa } from "@/server/shipping-orders";
import { setShipmentStatus } from "@/server/shipments";
import { createRequest } from "@/server/requests";
import { ensureRateReminder, feed, markAllRead, markRead, recordHistory, setSound } from "@/server/notifications";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, cs2: Actor, china: Actor;

async function customer(phone: string) {
  const acc = await signUp({ name: "Karim", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  return prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
}

async function agentFor(customerId: string) {
  const { token, account } = await createAgent(admin, { name: "Rafiq", phone: "01911000000" });
  await acceptInvite(token, "agent-pass-123");
  await assignAgent(admin, customerId, account.id);
  return { ...account, kind: "AGENT" as const };
}

const got = (type: string) => prisma.notification.findMany({ where: { type }, select: { userId: true, portalAccountId: true, link: true, title: true, body: true } });
const staffIds = (rows: { userId: string | null }[]) => rows.map((r) => r.userId).filter(Boolean).sort();
const accountIds = (rows: { portalAccountId: string | null }[]) => rows.map((r) => r.portalAccountId).filter(Boolean).sort();

async function receive(id: string) {
  const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: id } });
  await receiveShippingChina(china, id, { items: [{ itemId: item.id, quantityReceived: item.quantity, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "5" }] });
}

describe("Notifications", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    cs2 = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("has a template and a label for every event", () => {
    for (const type of Object.keys(RULES)) {
      expect(TEMPLATES[type as keyof typeof TEMPLATES]).toBeTypeOf("function");
      expect(TYPE_LABEL[type as keyof typeof TYPE_LABEL]).toBeTruthy();
    }
  });

  it("goes to the configured roles, the customer and their agent – never to whoever acted", async () => {
    const k = await customer("01711000000");
    const agent = await agentFor(k.customerId!);
    const so = await createPortalShippingOrder(k.customerId!, { shippingMethod: "AIR", qaRequested: true, items: [{ productName: "Shoes", quantity: 2 }] }, placedBy({ id: agent.id, name: agent.name, kind: "AGENT", customer: null }));

    const created = await got("SHIP_REQUEST_NEW");
    expect(staffIds(created)).toEqual([admin.id, cs.id, cs2.id, china.id].sort());
    expect(accountIds(created)).toEqual([k.id]); // the agent placed it: not told about their own action
    expect(created.find((r) => r.userId)?.link).toBe(`/shipping-orders/${so.id}`);
    expect(created.find((r) => r.portalAccountId)?.link).toBe(`/portal/shipping/${so.id}`);
    expect(staffIds(await got("QA_REQUESTED"))).toEqual([china.id]);

    // A staff action: that staff member is skipped, the other CS is told.
    await createRequest(cs, { customer: { name: "R", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
    expect(staffIds(await got("BUY_REQUEST_NEW"))).toEqual([admin.id, cs2.id, china.id].sort());

    // QA failed: customer, agent, Admin and CS – not the China user who recorded it.
    await receive(so.id);
    await recordQa(china, so.id, { result: "FAILED", notes: "Stitching loose" });
    const qa = await got("QA_FAILED");
    expect(staffIds(qa)).toEqual([admin.id, cs.id, cs2.id].sort());
    expect(accountIds(qa)).toEqual([k.id, agent.id].sort());
    expect(qa.find((r) => r.portalAccountId === agent.id)?.body).toMatch(/Customer: Karim/);
    expect(qa.find((r) => r.portalAccountId === k.id)?.title).toMatch(/^SHO-\d{6} QA test failed$/);
    // Staff-only events (QA task for China) show on the staff history, not the customer's.
    expect((await recordHistory({ shippingOrderId: so.id }, "staff")).map((h) => h.type)).toContain("QA_REQUESTED");
    expect((await recordHistory({ shippingOrderId: so.id }, "customer")).map((h) => h.type)).not.toContain("QA_REQUESTED");
  });

  it("customers hear every shipment step; staff-only events stay off their history", async () => {
    const k = await customer("01711000000");
    const so = await createPortalShippingOrder(k.customerId!, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 2 }] }, placedBy({ id: k.id, name: k.name, kind: "CUSTOMER", customer: { id: k.customerId! } }));
    await receive(so.id);
    const { shipment } = await assignShippingOrder(china, so.id, "auto");
    await setShipmentStatus(admin, shipment.id, "CLOSED");
    await setShipmentStatus(admin, shipment.id, "DEPARTED");
    await setShipmentStatus(admin, shipment.id, "ARRIVED_BD");

    const types = (await prisma.notification.findMany({ where: { portalAccountId: k.id }, orderBy: { createdAt: "asc" }, select: { type: true } })).map((n) => n.type);
    expect(types).toEqual(["RECEIVED_CHINA", "ASSIGNED_TO_SHIPMENT", "SHIPMENT_DEPARTED", "ARRIVED_BD"]); // not told about their own request
    expect(staffIds(await got("SHIPMENT_ARRIVED"))).toEqual([cs.id, cs2.id].sort()); // Admin acted

    const forCustomer = await recordHistory({ shippingOrderId: so.id }, "customer");
    expect(forCustomer.map((h) => h.type)).toContain("SHIPMENT_DEPARTED");
    expect(forCustomer.map((h) => h.type)).not.toContain("SHIPMENT_ARRIVED");
    const forStaff = await recordHistory({ shippingOrderId: so.id }, "staff");
    expect(forStaff.map((h) => h.type)).toEqual(expect.arrayContaining(forCustomer.map((h) => h.type)));
  });

  it("a login only sees and marks its own notifications", async () => {
    const a = await customer("01711000000");
    const b = await customer("01722000000");
    for (const acc of [a, b]) await createShippingOrder(cs, { customer: { id: acc.customerId!, name: "x", phone: acc.phone, address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Box", quantity: 1 }] });

    const fa = await feed({ accountId: a.id });
    const fb = await feed({ accountId: b.id });
    expect([fa.unread, fb.unread]).toEqual([1, 1]);
    expect(fa.latest[0].id).not.toBe(fb.latest[0].id);
    expect(fa.latest[0].ref).toMatch(/^SHO-/);

    await markRead({ accountId: a.id }, fb.latest[0].id); // someone else's: no effect
    expect((await feed({ accountId: b.id })).unread).toBe(1);
    await markRead({ accountId: a.id }, fa.latest[0].id);
    expect((await feed({ accountId: a.id })).unread).toBe(0);

    await markAllRead({ userId: cs2.id });
    expect((await feed({ userId: cs2.id })).unread).toBe(0);
    expect((await feed({ userId: admin.id })).unread).toBeGreaterThan(0);

    // "fresh" = new since the last poll (drives the toast + sound)
    const before = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await createShippingOrder(cs, { customer: { id: b.customerId!, name: "x", phone: b.phone, address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Box", quantity: 1 }] });
    expect((await feed({ accountId: b.id }, before)).fresh).toHaveLength(1);
    expect((await feed({ accountId: a.id }, before)).fresh).toHaveLength(0);

    await setSound({ accountId: a.id }, false);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: a.id } })).notifySound).toBe(false);
  });

  it("reminds Admins once a day after 10:00 when today's rate is missing", async () => {
    await prisma.exchangeRate.deleteMany();
    const morning = new Date("2026-10-14T03:00:00Z"); // 09:00 in Dhaka
    const later = new Date("2026-10-14T05:00:00Z"); // 11:00
    expect(await ensureRateReminder(morning)).toBe(false);
    expect(await ensureRateReminder(later)).toBe(true);
    expect(await ensureRateReminder(later)).toBe(false);
    expect(staffIds(await got("RATE_MISSING"))).toEqual([admin.id]);
    expect((await got("RATE_MISSING"))[0].link).toBe("/settings/exchange-rates");
  });
});
