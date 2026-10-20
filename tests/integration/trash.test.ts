import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { acceptInvite, approveAccount, signUp } from "@/server/portal-auth";
import { assignAgent, createAgent } from "@/server/agents";
import { placedBy } from "@/server/portal-access";
import { createPortalRequest } from "@/server/requests";
import { portalOrder } from "@/server/portal";
import { saveQuotation, submitQuotation } from "@/server/estimates";
import { invoiceSample, purchaseSample, recordSamplePayment, requestSampleFromPortal, shipSample } from "@/server/samples";
import { createShipment } from "@/server/shipments";
import { FK_RULES, deleteForever, listForeignKeys, listTrash, moveToTrash, previewDelete, restoreFromTrash } from "@/server/trash";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const FUTURE = new Date("2099-01-01T00:00:00Z");

/** Every table's rows (except the audit log and Trash itself), to compare before / after. */
async function dump() {
  const tables = await prisma.$queryRaw<{ t: string }[]>`select tablename as t from pg_tables where schemaname = current_schema() order by 1`;
  const out: Record<string, unknown> = {};
  for (const { t } of tables) {
    if (["AuditLog", "TrashItem", "_prisma_migrations"].includes(t)) continue;
    const [{ j }] = await prisma.$queryRawUnsafe<{ j: unknown }[]>(`select coalesce(jsonb_agg(to_jsonb(x) order by x::text), '[]') as j from "${t}" x`);
    out[t] = j;
  }
  return out;
}

/** Customer with an agent; a quoted request; a paid, purchased sample shipped in a sea shipment. */
async function world() {
  const acc = await signUp({ name: "Karim", phone: "01711000000", password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const customer = await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
  const customerId = customer.customerId!;
  const { token, account } = await createAgent(admin, { name: "Rafiq", phone: "01911000000" });
  await acceptInvite(token, "agent-pass-123");
  await assignAgent(admin, customerId, account.id);
  const agent = { id: account.id, name: account.name, kind: "AGENT" as const, customer: null };
  const { order } = await createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 10, links: [] }, { productName: "Shade", quantity: 4, links: [] }] }, placedBy(agent));
  const lines = await prisma.orderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
  const e = await saveQuotation(china, order.id, {
    shippingMethod: "AIR",
    shippingRatePerKgRmb: "40",
    validUntil: FUTURE,
    lines: lines.map((l) => ({ orderLineId: l.id, unitPriceRmb: "12.50", unitWeightKg: "0.35" })),
  });
  await submitQuotation(china, e.id);
  const s = await requestSampleFromPortal(agent, customerId, order.id, { lines: [{ orderLineId: lines[0].id, quantity: 1 }] });
  await invoiceSample(china, s.id, { shipWay: "SEA", productRmb: "25", shippingToBdRmb: "15", paymentRequired: true });
  await recordSamplePayment(cs, s.id, { amountBdt: "680", method: "BKASH" });
  await purchaseSample(china, s.id, { supplierName: "Shop", purchaseTrackingUrl: "https://t.example/1", expectedAtWarehouseAt: FUTURE, paidRmb: "28" });
  const sea = await createShipment(admin, { method: "SEA", cutoffDate: FUTURE, openNow: true });
  await shipSample(china, s.id, { shippingMode: "WEEKLY_SHIPMENT", method: "SEA", shipmentId: sea.id });
  return { customerId, agentId: account.id, order, estimate: e, sample: s, sea };
}

describe("Trash: Admin deletes any record and can restore it", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("every foreign key in the database has a delete rule (required links are never just cleared)", async () => {
    const fks = await listForeignKeys();
    expect(fks.filter((f) => !FK_RULES[`${f.child}.${f.column}`]).map((f) => `${f.child}.${f.column}`)).toEqual([]);
    expect(fks.filter((f) => f.required && FK_RULES[`${f.child}.${f.column}`] === "unlink").map((f) => `${f.child}.${f.column}`)).toEqual([]);
    const live = new Set(fks.map((f) => `${f.child}.${f.column}`));
    expect(Object.keys(FK_RULES).filter((k) => !live.has(k))).toEqual([]);
  });

  it("only Admin may delete, restore or empty the Trash", async () => {
    const { order } = await world();
    await expect(previewDelete(cs, "Order", order.id)).rejects.toThrow(ForbiddenError);
    await expect(moveToTrash(cs, "Order", order.id)).rejects.toThrow(ForbiddenError);
    await expect(moveToTrash(china, "Order", order.id)).rejects.toThrow(ForbiddenError);
    const id = await moveToTrash(admin, "Order", order.id);
    await expect(restoreFromTrash(cs, id)).rejects.toThrow(ForbiddenError);
    await expect(deleteForever(cs)).rejects.toThrow(ForbiddenError);
    await expect(listTrash(cs)).rejects.toThrow(ForbiddenError);
  });

  it("an order goes to Trash with its quote, sample and payments; restore brings back exactly the same data", async () => {
    const { customerId, order, sample } = await world();
    const before = await dump();

    const pv = await previewDelete(admin, "Order", order.id);
    expect(pv.label).toMatch(/^Request REQ-\d{6} – Karim$/);
    expect(pv.blocked).toBeNull();
    expect(pv.payments).toEqual({ count: 1, totalBdt: "680.00" });
    const counts = Object.fromEntries(pv.counts.map((c) => [c.table, c.count]));
    expect([counts.OrderLine, counts.Estimate, counts.Sample, counts.Payment]).toEqual([2, 1, 1, 1]);

    const trashId = await moveToTrash(admin, "Order", order.id);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.sample.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.customer.count({ where: { id: customerId } })).toBe(1);
    expect(await portalOrder(customerId, order.id)).toBeNull();
    const [t] = await listTrash(admin);
    expect([t.entityType, t.label, t.deletedBy?.name]).toEqual(["Order", pv.label, (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).name]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: order.id, field: "movedToTrash" } });
    expect(audit.userId).toBe(admin.id);

    const r = await restoreFromTrash(admin, trashId);
    expect(r).toEqual({ type: "Order", id: order.id, href: `/requests/${order.id}` });
    expect(await dump()).toEqual(before);
    expect(await prisma.trashItem.count()).toBe(0);
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: sample.id } })).paidRmb?.toString()).toBe("28");
  });

  it("a customer goes with all their orders, samples and portal login; the agent stays", async () => {
    const { customerId, agentId } = await world();
    const before = await dump();
    const trashId = await moveToTrash(admin, "Customer", customerId);
    expect([await prisma.customer.count(), await prisma.order.count(), await prisma.sample.count(), await prisma.estimate.count()]).toEqual([0, 0, 0, 0]);
    expect((await prisma.portalAccount.findMany({ select: { id: true } })).map((a) => a.id)).toEqual([agentId]);
    await restoreFromTrash(admin, trashId);
    expect(await dump()).toEqual(before);
  });

  it("deleting a weekly shipment only takes the sample out of it; restore puts it back", async () => {
    const { sample, sea } = await world();
    const before = await dump();
    const trashId = await moveToTrash(admin, "Shipment", sea.id);
    expect((await prisma.sample.findUniqueOrThrow({ where: { id: sample.id } })).shipmentId).toBeNull();
    await restoreFromTrash(admin, trashId);
    expect(await dump()).toEqual(before);
  });

  it("an order can't come back before its customer; restoring the customer first works", async () => {
    const { customerId, order } = await world();
    const before = await dump();
    const orderTrash = await moveToTrash(admin, "Order", order.id);
    const customerTrash = await moveToTrash(admin, "Customer", customerId);
    await expect(restoreFromTrash(admin, orderTrash)).rejects.toThrow(/belongs to “Customer .* – Karim”, which is also in Trash/);
    await restoreFromTrash(admin, customerTrash);
    await restoreFromTrash(admin, orderTrash);
    expect(await dump()).toEqual(before);
  });

  it("staff with history, used exchange rates and your own login can't be deleted; an unused staff login can", async () => {
    await world();
    await expect(moveToTrash(admin, "User", china.id)).rejects.toThrow(/has history .* Disable the login instead/);
    await expect(moveToTrash(admin, "User", admin.id)).rejects.toThrow(/your own login/);
    const rate = await prisma.exchangeRate.findFirstOrThrow();
    expect((await previewDelete(admin, "ExchangeRate", rate.id)).blocked).toMatch(/used by .*quotation/);
    await expect(moveToTrash(admin, "ExchangeRate", rate.id)).rejects.toThrow(/can't be deleted/);

    const extra = await makeUser("CS");
    const id = await moveToTrash(admin, "User", extra.id);
    expect(await prisma.user.count({ where: { id: extra.id } })).toBe(0);
    await restoreFromTrash(admin, id);
    expect(await prisma.user.count({ where: { id: extra.id } })).toBe(1);
  });

  it("delete forever removes the Trash copy for good", async () => {
    const { order, sea } = await world();
    const a = await moveToTrash(admin, "Order", order.id);
    await moveToTrash(admin, "Shipment", sea.id);
    expect(await deleteForever(admin, [a])).toBe(1);
    await expect(restoreFromTrash(admin, a)).rejects.toThrow(/no longer in Trash/);
    expect(await deleteForever(admin)).toBe(1);
    expect(await prisma.trashItem.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { field: "deletedForever" } })).toBe(2);
  });
});
