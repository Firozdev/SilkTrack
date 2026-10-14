import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { acceptInvite, accountForSession, approveAccount, authenticate, createResetToken, createSession, setAccountDisabled, signUp } from "@/server/portal-auth";
import { assignAgent, createAgent, reinviteAgent } from "@/server/agents";
import { agentAddCustomer, agentCustomers, allowedCustomerIds, customerForNew, ownerOf, placedBy, requireOwner, type PortalLogin } from "@/server/portal-access";
import { portalAttachment, portalDashboard, portalLists } from "@/server/portal";
import { createPortalRequest } from "@/server/requests";
import { createPortalShippingOrder } from "@/server/shipping-orders";
import { adminInbox } from "@/server/dashboard";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor;
const PW = "agent-pass-123";

/** Create an agent, accept the invite and return their session view. */
async function agent(phone: string, name = "Rafiq"): Promise<PortalLogin> {
  const { token, account } = await createAgent(admin, { name, phone });
  await acceptInvite(token, PW);
  const { token: session } = await createSession(account.id);
  return (await accountForSession(session))!;
}

async function customerLogin(phone: string) {
  const acc = await signUp({ name: "Karim", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const { token } = await createSession(acc.id);
  return (await accountForSession(token))!;
}

const request = (customerId: string, by?: PortalLogin) => createPortalRequest(customerId, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] }, by && placedBy(by));

describe("Agents in the portal", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("only Admin creates agents; they log in after setting a password", async () => {
    await expect(createAgent(cs, { name: "X", phone: "01911000000" })).rejects.toThrow(ForbiddenError);
    const { token, account } = await createAgent(admin, { name: "Rafiq", phone: "01911000000" });
    expect([account.kind, account.status, account.customerId]).toEqual(["AGENT", "INVITED", null]);
    expect((await authenticate("01911000000", PW)).ok).toBe(false);
    await expect(createAgent(admin, { name: "Dup", phone: "01911000000" })).rejects.toThrow(/already has a portal login/);

    const again = await reinviteAgent(admin, account.id);
    await expect(acceptInvite(token, PW)).rejects.toThrow(/expired or was already used/); // old link replaced
    await acceptInvite(again.token, PW);
    expect((await authenticate("01911000000", PW)).ok).toBe(true);
    const { token: s } = await createSession(account.id);
    expect(await accountForSession(s)).toMatchObject({ kind: "AGENT", customer: null, name: "Rafiq" });
  });

  it("agents add customers; a phone already on file is refused", async () => {
    const a = await agent("01911000000");
    await customerLogin("01711000000"); // an existing customer
    const c = await agentAddCustomer(a, { name: "Salma", phone: "01811000000", address: "Uttara" });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ agentAccountId: a.id, source: "PORTAL" });
    await expect(agentAddCustomer(a, { name: "Salma", phone: "01811000000", address: "x" })).rejects.toThrow(/already in your list/);
    await expect(agentAddCustomer(a, { name: "K", phone: "01711000000", address: "x" })).rejects.toThrow(/already have a customer/);
    expect((await agentCustomers(a.id)).map((x) => x.name)).toEqual(["Salma"]);
  });

  it("an agent sees and acts only for their own customers", async () => {
    const a = await agent("01911000000", "Rafiq");
    const b = await agent("01922000000", "Jamal");
    const mine = await agentAddCustomer(a, { name: "Salma", phone: "01811000000", address: "Uttara" });
    const theirs = await agentAddCustomer(b, { name: "Rina", phone: "01822000000", address: "Banani" });
    const loner = await customerLogin("01711000000");

    // Creating: only for own customers
    expect(await customerForNew(a, mine.id)).toBe(mine.id);
    await expect(customerForNew(a, theirs.id)).rejects.toThrow(/not found/);
    await expect(customerForNew(a, loner.customer!.id)).rejects.toThrow(/not found/);
    await expect(customerForNew(a, undefined)).rejects.toThrow(/Choose the customer/);
    // A customer login always orders for itself, whatever the form says
    expect(await customerForNew(loner, mine.id)).toBe(loner.customer!.id);

    const { order } = await request(mine.id, a);
    expect(order).toMatchObject({ customerId: mine.id, source: "PORTAL", placedByAccountId: a.id });
    const so = await createPortalShippingOrder(mine.id, { shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 1 }] }, placedBy(a));
    const { order: lonerOrder } = await request(loner.customer!.id, loner);
    const notice = await prisma.notification.findFirstOrThrow({ where: { type: "PORTAL_REQUEST", orderId: order.id } });
    expect(notice.body).toMatch(/from agent Rafiq/);

    // Reading: agent A yes, agent B and other customers no
    expect(await ownerOf(a, "order", order.id)).toBe(mine.id);
    expect(await ownerOf(a, "shipping", so.id)).toBe(mine.id);
    expect(await ownerOf(b, "order", order.id)).toBeNull();
    expect(await ownerOf(a, "order", lonerOrder.id)).toBeNull();
    expect(await ownerOf(loner, "order", order.id)).toBeNull();
    await expect(requireOwner(b, "shipping", so.id)).rejects.toThrow(/Not found/);
    expect((await portalLists(await allowedCustomerIds(a))).orders.map((o) => o.id)).toEqual([order.id]);

    // Files follow the same rule
    const att = await prisma.attachment.create({ data: { kind: "PRODUCT_IMAGE", fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1, storageKey: "k", orderId: order.id, uploadedByAccountId: a.id } });
    expect(await portalAttachment(await allowedCustomerIds(a), att.id)).not.toBeNull();
    expect(await portalAttachment(await allowedCustomerIds(b), att.id)).toBeNull();

    // Admin sees who placed it
    const buy = (await adminInbox(admin)).find((p) => p.key === "buy")!;
    expect(buy.items.find((i) => i.id === order.id)?.tag).toBe("Agent");
    expect(buy.items.find((i) => i.id === lonerOrder.id)?.tag).toBe("Portal");
  });

  it("the customer's own login sees orders their agent placed", async () => {
    const a = await agent("01911000000");
    const k = await customerLogin("01711000000");
    await assignAgent(admin, k.customer!.id, a.id);
    const { order } = await request(k.customer!.id, a);
    expect((await portalDashboard(k.customer!.id)).orders.map((o) => o.id)).toEqual([order.id]);
    expect(await ownerOf(k, "order", order.id)).toBe(k.customer!.id);
  });

  it("Admin assigns and removes customers; access ends at once", async () => {
    const a = await agent("01911000000");
    const k = await customerLogin("01711000000");
    const { order } = await request(k.customer!.id, k);
    await expect(assignAgent(cs, k.customer!.id, a.id)).rejects.toThrow(ForbiddenError);
    expect(await ownerOf(a, "order", order.id)).toBeNull();

    await assignAgent(admin, k.customer!.id, a.id);
    expect(await ownerOf(a, "order", order.id)).toBe(k.customer!.id);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: k.customer!.id, field: "agentAccountId" } });
    expect(log.userId).toBe(admin.id);

    await assignAgent(admin, k.customer!.id, null);
    expect(await ownerOf(a, "order", order.id)).toBeNull();
    await expect(assignAgent(admin, k.customer!.id, k.id)).rejects.toThrow(/Agent not found/); // a customer login isn't an agent
  });

  it("only Admin resets or disables an agent's login", async () => {
    const a = await agent("01911000000");
    await expect(createResetToken(cs, a.id)).rejects.toThrow(ForbiddenError);
    await expect(setAccountDisabled(cs, a.id, true)).rejects.toThrow(ForbiddenError);
    await setAccountDisabled(admin, a.id, true);
    expect((await authenticate("01911000000", PW)).ok).toBe(false);
  });
});
