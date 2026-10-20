import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { FK_RULES, TRASHABLE, deleteForever, listForeignKeys, listTrash, moveToTrash, previewDelete, restoreFromTrash } from "@/server/trash";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

// Uploaded files go to a temporary folder for this test file.
const UPLOADS = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/silktrack-trash-${process.pid}`;
  process.env.UPLOAD_DIR = dir;
  return dir;
});

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

  it("every kind of record with a Delete button: preview, delete, restore gives back the same data", async () => {
    const w = await world();
    const ids = await everyKind(w);
    expect(Object.keys(TRASHABLE).filter((t) => !ids[t]).sort()).toEqual([]);
    for (const [type, id] of Object.entries(ids)) {
      const before = await dump();
      const pv = await previewDelete(admin, type as keyof typeof TRASHABLE, id);
      expect(pv.label, type).toMatch(/\w/);
      expect(pv.blocked, type).toBeNull();
      const trashId = await moveToTrash(admin, type as keyof typeof TRASHABLE, id);
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from "${type}" where id = $1`, id);
      expect(n, `${type} deleted`).toBe(0);
      const r = await restoreFromTrash(admin, trashId);
      expect(r.href, type).toBe(TRASHABLE[type as keyof typeof TRASHABLE].href?.(id) ?? null);
      expect(await dump(), `${type} restored exactly`).toEqual(before);
    }
  });

  it("uploaded files stay while in Trash and are removed by delete forever", async () => {
    const { order } = await world();
    const c = await prisma.comment.create({ data: { orderId: order.id, authorId: admin.id, body: "see photo" } });
    mkdirSync(UPLOADS, { recursive: true });
    const file = path.join(UPLOADS, "trash-test-photo.png");
    writeFileSync(file, "png");
    await prisma.attachment.create({ data: { commentId: c.id, kind: "PRODUCT_IMAGE", storageKey: "trash-test-photo.png", fileName: "photo.png", mimeType: "image/png", sizeBytes: 3 } });

    let trashId = await moveToTrash(admin, "Comment", c.id);
    expect(existsSync(file)).toBe(true);
    await restoreFromTrash(admin, trashId);
    expect(await prisma.attachment.count({ where: { commentId: c.id } })).toBe(1);
    trashId = await moveToTrash(admin, "Order", order.id);
    expect((await previewDelete(admin, "Customer", (await prisma.customer.findFirstOrThrow()).id)).files).toBe(0);
    await deleteForever(admin, [trashId]);
    expect(existsSync(file)).toBe(false);
  });

  it("a customer with 150 requests is deleted and restored in reasonable time", async () => {
    const { customerId } = await world();
    for (let i = 0; i < 150; i++) {
      await prisma.order.create({
        data: {
          customerId,
          source: "STAFF",
          createdById: admin.id,
          shippingMethod: "AIR",
          lines: { create: [1, 2, 3].map((lineNo) => ({ lineNo, productName: `P${i}-${lineNo}`, quantity: 1, trackingEvents: { create: { leg: "SUPPLIER_TO_CHINA", status: "REQUESTED", message: "x" } } })) },
          comments: { create: { authorId: admin.id, body: `c${i}` } },
        },
      });
    }
    const before = await dump();
    let t = Date.now();
    const trashId = await moveToTrash(admin, "Customer", customerId);
    const del = Date.now() - t;
    t = Date.now();
    await restoreFromTrash(admin, trashId);
    const res = Date.now() - t;
    console.log(`150 requests (450 lines): delete ${del} ms, restore ${res} ms`);
    expect(await dump()).toEqual(before);
    expect(del + res).toBeLessThan(15_000);
  }, 60_000);
});

/** One record of every kind that has a Delete button (on top of world()). */
async function everyKind(w: Awaited<ReturnType<typeof world>>): Promise<Record<string, string>> {
  const rate = await prisma.exchangeRate.findFirstOrThrow();
  const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: w.order.id } });
  const supplier = await prisma.supplier.create({ data: { name: "Yiwu Lamps", platform: "ALIBABA_1688" } });
  const po = await prisma.supplierOrder.create({
    data: {
      supplierId: supplier.id, platform: "ALIBABA_1688", purchasedById: china.id, purchaseDate: new Date(), productTotalRmb: "125", totalRmb: "125",
      exchangeRateId: rate.id, rateUsed: rate.rate, totalBdt: "2125",
      lines: { create: { orderLineId: line.id, quantity: 10, unitPriceRmb: "12.5", productTotalRmb: "125", totalRmb: "125", rateUsed: rate.rate, totalBdt: "2125" } },
    },
  });
  const rcv = await prisma.receiving.create({ data: { receivedAt: new Date(), receivedById: china.id, grossWeightKg: "2", cbm: "0.01", shippingMethod: "AIR", supplierOrderId: po.id, lines: { create: { orderLineId: line.id, quantityOrdered: 10, quantityReceived: 10 } } } });
  const issue = await prisma.issue.create({ data: { type: "DAMAGED", source: "CHINA_RECEIVING", description: "box crushed", reportedById: china.id, orderId: w.order.id, receivingId: rcv.id } });
  const invoice = await prisma.invoice.create({ data: { orderId: w.order.id, exchangeRateId: rate.id, rateUsed: rate.rate, productCostRmb: "125", productCostBdt: "2125", totalBdt: "3000", balanceDueBdt: "3000" } });
  const claim = await prisma.claim.create({ data: { orderId: w.order.id, description: "one broken", createdById: cs.id, issueId: issue.id } });
  const delivery = await prisma.delivery.create({ data: { orderId: w.order.id, courier: "PATHAO", assignedById: cs.id } });
  const comment = await prisma.comment.create({ data: { orderId: w.order.id, authorId: cs.id, body: "call before delivery" } });
  const file = await prisma.attachment.create({ data: { orderId: w.order.id, kind: "PRODUCT_IMAGE", storageKey: "missing.png", fileName: "lamp.png", mimeType: "image/png", sizeBytes: 1 } });
  const sho = await prisma.shippingOrder.create({ data: { customerId: w.customerId, shipmentId: w.sea.id } });
  const shippingRate = await prisma.shippingRate.create({ data: { effectiveFrom: new Date("2026-01-01T00:00:00Z"), airPerKgBdt: "900" } });
  await prisma.shippingOrder.update({ where: { id: sho.id }, data: { shippingRateId: shippingRate.id } });
  const customerLogin = await prisma.portalAccount.findFirstOrThrow({ where: { customerId: w.customerId } });
  const proof = await prisma.paymentSubmission.create({ data: { customerId: w.customerId, accountId: customerLogin.id, orderId: w.order.id, amountBdt: "1000", method: "BKASH", reference: "TX1", paidAt: new Date() } });
  const payment = await prisma.payment.findFirstOrThrow();
  const unusedRate = await makeRate("2020-01-01", "15", admin.id);
  const unusedUser = await makeUser("CS");
  return {
    Customer: w.customerId, Order: w.order.id, Estimate: w.estimate.id, Sample: w.sample.id, ShippingOrder: sho.id, Shipment: w.sea.id,
    SupplierOrder: po.id, Receiving: rcv.id, Payment: payment.id, Invoice: invoice.id, PaymentSubmission: proof.id, Issue: issue.id,
    Claim: claim.id, Delivery: delivery.id, Comment: comment.id, Attachment: file.id, Supplier: supplier.id, PortalAccount: w.agentId,
    User: unusedUser.id, ExchangeRate: unusedRate.id, ShippingRate: shippingRate.id,
  };
}
