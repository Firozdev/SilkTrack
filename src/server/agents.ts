import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { hashPassword } from "@/lib/password";
import { normalizeBdPhone } from "@/lib/phone";
import { logChanges } from "@/lib/audit";
import { newToken, storeInviteToken } from "./portal-auth";
import type { Actor } from "./actor";

/**
 * Agents: our people who order in the portal for several customers. Admin
 * creates the login (with a "set your password" link) and decides which
 * customers each agent looks after; agents can also add new customers.
 */

export type AgentInput = { name: string; phone: string; email?: string };

/** New agent login, waiting for a password. Returns the raw invite token. */
export async function createAgent(actor: Actor, input: AgentInput, now = new Date()) {
  assertCan(actor.role, "agent:manage");
  const phone = normalizeBdPhone(input.phone);
  if (!phone) throw new UserError("Enter a valid Bangladesh mobile number (01XXXXXXXXX)");
  if (!input.name.trim()) throw new UserError("Name is required");
  if (await prisma.portalAccount.findUnique({ where: { phone } })) throw new UserError("This mobile number already has a portal login");
  const { token, tokenHash } = newToken();
  const acc = await prisma.$transaction(async (tx) => {
    const acc = await tx.portalAccount.create({
      data: { kind: "AGENT", phone, name: input.name.trim(), email: input.email?.trim() || null, address: "", status: "INVITED", invitedById: actor.id, invitedAt: now, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
    });
    await storeInviteToken(tx, acc.id, tokenHash, actor.id, now);
    await logChanges(tx, { entityType: "PortalAccount", entityId: acc.id, userId: actor.id, action: "CREATE" });
    return acc;
  });
  return { token, account: acc };
}

/** A fresh invite link for an agent who hasn't set a password yet (the old link stops working). */
export async function reinviteAgent(actor: Actor, accountId: string, now = new Date()) {
  assertCan(actor.role, "agent:manage");
  const acc = await prisma.portalAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.kind !== "AGENT") throw new UserError("Agent not found");
  if (acc.status !== "INVITED") throw new UserError("This agent already set a password – create a password reset link instead");
  const { token, tokenHash } = newToken();
  await prisma.$transaction((tx) => storeInviteToken(tx, acc.id, tokenHash, actor.id, now));
  return { token, account: acc };
}

/** Give a customer to an agent, or take them away (agentAccountId null). */
export async function assignAgent(actor: Actor, customerId: string, agentAccountId: string | null) {
  assertCan(actor.role, "agent:manage");
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { agentAccountId: true } });
  if (!c) throw new UserError("Customer not found");
  if (agentAccountId) {
    const a = await prisma.portalAccount.findUnique({ where: { id: agentAccountId }, select: { kind: true } });
    if (a?.kind !== "AGENT") throw new UserError("Agent not found");
  }
  if (c.agentAccountId === agentAccountId) return;
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { agentAccountId } });
    await logChanges(tx, { entityType: "Customer", entityId: customerId, userId: actor.id, action: "UPDATE", changes: [{ field: "agentAccountId", oldValue: c.agentAccountId, newValue: agentAccountId }] });
  });
}

export function listAgents() {
  return prisma.portalAccount.findMany({
    where: { kind: "AGENT" },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      agentCustomers: { orderBy: { name: "asc" }, select: { id: true, code: true, name: true, phone: true } },
      _count: { select: { placedOrders: true, placedShipping: true } },
    },
  });
}
