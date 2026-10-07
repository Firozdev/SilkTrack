import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { acceptInvite, approveAccount, authenticate, inviteCustomer, rejectAccount, signUp, tokenValid } from "@/server/portal-auth";
import { portalDashboard } from "@/server/portal";
import { createRequest } from "@/server/requests";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let cs: Actor, china: Actor;
const PW = "secret-pass-1";
const staffCustomer = async (phone: string, name = "Old customer") =>
  (await createRequest(cs, { customer: { name, phone, address: "Gulshan" }, shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 1, links: [] }] })).order;

describe("One customer database: portal sign-ups and invitations", () => {
  beforeEach(async () => {
    await resetDb();
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
  });

  it("a sign-up lands in the customer list at once, tagged Portal, login pending until approved", async () => {
    const acc = await signUp({ name: "Nila", phone: "01711000000", password: PW, address: "Mirpur" });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: acc.customerId! } });
    expect([c.name, c.phone, c.source]).toEqual(["Nila", "01711000000", "PORTAL"]);
    expect(acc.status).toBe("PENDING");
    expect((await authenticate("01711000000", PW)).ok).toBe(false);
    await approveAccount(cs, acc.id);
    expect(await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).toMatchObject({ status: "ACTIVE", customerId: c.id });
    expect((await authenticate("01711000000", PW)).ok).toBe(true);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("a sign-up with an existing customer's phone is not linked until staff confirm", async () => {
    const order = await staffCustomer("+8801811000000");
    const acc = await signUp({ name: "Someone", phone: "01811000000", password: PW, address: "x" });
    expect(acc.customerId).toBeNull();
    expect(await prisma.customer.count()).toBe(1); // no duplicate created
    await expect(approveAccount(cs, acc.id)).rejects.toThrow(/Choose which customer/);
    await expect(approveAccount(cs, acc.id, "new")).rejects.toThrow(/already exists/);
    await approveAccount(cs, acc.id, order.customerId);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).customerId).toBe(order.customerId);
    // They now see the orders staff entered before
    expect((await portalDashboard(order.customerId)).orders.map((o) => o.id)).toEqual([order.id]);
  });

  it("rejecting a spam sign-up removes the empty customer it created; a used one is kept", async () => {
    const spam = await signUp({ name: "Spam", phone: "01911000000", password: PW, address: "x" });
    await rejectAccount(cs, spam.id, "Not a real customer");
    expect(await prisma.customer.count({ where: { id: spam.customerId! } })).toBe(0);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: spam.id } })).customerId).toBeNull();

    const real = await signUp({ name: "Real", phone: "01611000000", password: PW, address: "x" });
    await createRequest(cs, { customer: { id: real.customerId!, name: "Real", phone: "01611000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "a", quantity: 1, links: [] }] });
    await rejectAccount(cs, real.id, "Wrong details");
    expect(await prisma.customer.count({ where: { id: real.customerId! } })).toBe(1);
  });

  it("approving into another existing customer removes the empty sign-up customer", async () => {
    const old = await staffCustomer("01522000000", "Old Rahim");
    const acc = await signUp({ name: "Rahim", phone: "01722000000", password: PW, address: "x" }); // new phone → own customer
    await approveAccount(cs, acc.id, old.customerId);
    expect(await prisma.customer.count({ where: { id: acc.customerId! } })).toBe(0);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).customerId).toBe(old.customerId);
  });

  it("staff invite an existing customer; the link sets the password once; resending kills the old link", async () => {
    const order = await staffCustomer("01733000000");
    await expect(inviteCustomer(china, order.customerId)).rejects.toThrow(ForbiddenError);
    const first = await inviteCustomer(cs, order.customerId);
    const acc = await prisma.portalAccount.findUniqueOrThrow({ where: { phone: "01733000000" } });
    expect([acc.status, acc.customerId, acc.invitedById]).toEqual(["INVITED", order.customerId, cs.id]);
    expect(await authenticate("01733000000", "anything-at-all")).toEqual({ ok: false, error: "Wrong phone number or password." });
    await expect(signUp({ name: "x", phone: "01733000000", password: PW, address: "x" })).rejects.toThrow(/already have an invitation/);

    const second = await inviteCustomer(cs, order.customerId);
    expect(await tokenValid(first.token, "INVITE")).toBeNull();
    await expect(acceptInvite(first.token, PW)).rejects.toThrow(/expired or was already used/);
    await expect(acceptInvite(second.token, "short")).rejects.toThrow(/at least 8/);
    await acceptInvite(second.token, PW);
    expect((await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe("ACTIVE");
    expect((await authenticate("01733000000", PW)).ok).toBe(true);
    await expect(acceptInvite(second.token, PW)).rejects.toThrow(/already used/);
    // Their existing order is visible straight away
    expect((await portalDashboard(order.customerId)).orders).toHaveLength(1);
    await expect(inviteCustomer(cs, order.customerId)).rejects.toThrow(/already uses the portal/);
  });

  it("invitations need a valid mobile and no other open login", async () => {
    const bad = await staffCustomer("02-9123456");
    await expect(inviteCustomer(cs, bad.customerId)).rejects.toThrow(/valid Bangladesh mobile/);
    const pending = await signUp({ name: "P", phone: "01744000000", password: PW, address: "x" });
    await expect(inviteCustomer(cs, pending.customerId!)).rejects.toThrow(/sign-up waiting – approve it instead/);
  });
});
