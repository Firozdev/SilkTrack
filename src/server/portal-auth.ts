import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PortalAccountStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/password";
import { normalizeBdPhone, phoneVariants } from "@/lib/phone";
import { logChanges } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { findOrCreateCustomer } from "./requests";
import type { Actor } from "./actor";

export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const RESET_HOURS = 24;

/** Random URL-safe token; only its SHA-256 is stored. */
export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Compared against when the phone is unknown, so response time doesn't reveal which phones have accounts.
let dummyHash: Promise<string> | undefined;
const dummy = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

function phoneOrThrow(phone: string) {
  const p = normalizeBdPhone(phone);
  if (!p) throw new UserError("Enter a valid Bangladesh mobile number (01XXXXXXXXX)");
  return p;
}

function passwordOrThrow(pw: string) {
  if (pw.length < MIN_PASSWORD_LENGTH) throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}

export type SignUpInput = { name: string; phone: string; email?: string; password: string; address: string; district?: string; area?: string };

/** Self sign-up. The account stays PENDING until staff approve it. */
export async function signUp(input: SignUpInput) {
  const phone = phoneOrThrow(input.phone);
  passwordOrThrow(input.password);
  if (!input.name.trim() || !input.address.trim()) throw new UserError("Name and delivery address are required");
  const existing = await prisma.portalAccount.findUnique({ where: { phone } });
  if (existing && existing.status !== "REJECTED") throw new UserError("An account with this phone number already exists. Log in, or contact us if you forgot the password.");
  const data = {
    phone,
    name: input.name.trim(),
    email: input.email?.trim() || null,
    passwordHash: await hashPassword(input.password),
    address: input.address.trim(),
    district: input.district?.trim() || null,
    area: input.area?.trim() || null,
    status: "PENDING" as const,
    customerId: null,
    rejectReason: null,
    reviewedById: null,
    reviewedAt: null,
    failedLogins: 0,
    lockedUntil: null,
  };
  // A rejected phone may sign up again (e.g. after correcting details).
  const acc = existing ? await prisma.portalAccount.update({ where: { id: existing.id }, data }) : await prisma.portalAccount.create({ data });
  await notifyRoles(["CS", "ADMIN"], { type: "PORTAL_SIGNUP", title: `Portal sign-up: ${acc.name}`, body: `${acc.phone} – review and approve in Portal accounts.` });
  return acc;
}

export type LoginResult = { ok: true; accountId: string } | { ok: false; error: string };

/**
 * Check phone + password. Wrong passwords count towards a temporary lock;
 * pending / rejected / disabled accounts get a clear message only once the
 * password is right (so it can't be used to probe other people's status).
 */
export async function authenticate(phoneInput: string, password: string, now = new Date()): Promise<LoginResult> {
  const generic = { ok: false as const, error: "Wrong phone number or password." };
  const phone = normalizeBdPhone(phoneInput);
  const acc = phone ? await prisma.portalAccount.findUnique({ where: { phone } }) : null;
  if (!acc) {
    await verifyPassword(password, await dummy());
    return generic;
  }
  if (acc.lockedUntil && acc.lockedUntil > now) return { ok: false, error: `Too many wrong attempts. Try again after ${LOCK_MINUTES} minutes.` };
  if (!(await verifyPassword(password, acc.passwordHash))) {
    const failed = acc.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.portalAccount.update({ where: { id: acc.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null } });
    return lock ? { ok: false, error: `Too many wrong attempts. Try again after ${LOCK_MINUTES} minutes.` } : generic;
  }
  const blocked: Partial<Record<PortalAccountStatus, string>> = {
    PENDING: "Your account is waiting for approval. We will contact you soon.",
    REJECTED: `Your sign-up was not approved${acc.rejectReason ? `: ${acc.rejectReason}` : ""}. Please contact us.`,
    DISABLED: "This account is disabled. Please contact us.",
  };
  if (blocked[acc.status] || !acc.customerId) return { ok: false, error: blocked[acc.status] ?? blocked.PENDING! };
  await prisma.portalAccount.update({ where: { id: acc.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
  return { ok: true, accountId: acc.id };
}

export async function createSession(accountId: string, now = new Date()) {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await prisma.portalSession.create({ data: { tokenHash, accountId, expiresAt } });
  return { token, expiresAt };
}

/** The active, approved account behind a session token, or null. */
export async function accountForSession(token: string | undefined, now = new Date()) {
  if (!token) return null;
  const s = await prisma.portalSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { account: { include: { customer: { select: { id: true, code: true, name: true, phone: true, email: true, address: true, district: true, area: true } } } } },
  });
  if (!s || s.expiresAt <= now) return null;
  const a = s.account;
  if (a.status !== "ACTIVE" || !a.customer) return null;
  return { id: a.id, name: a.name, phone: a.phone, customer: a.customer };
}

export async function endSession(token: string | undefined) {
  if (token) await prisma.portalSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// ───────────────────────── Password reset ─────────────────────────

/** Staff create a one-time reset link to send the customer by WhatsApp. Returns the raw token. */
export async function createResetToken(actor: Actor, accountId: string, now = new Date()) {
  assertCan(actor.role, "request:edit");
  const acc = await prisma.portalAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new UserError("Account not found");
  if (acc.status !== "ACTIVE") throw new UserError("Only active accounts can reset their password");
  const { token, tokenHash } = newToken();
  await prisma.$transaction([
    // Only the newest link works.
    prisma.portalToken.updateMany({ where: { accountId, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: now } }),
    prisma.portalToken.create({ data: { tokenHash, accountId, purpose: "PASSWORD_RESET", expiresAt: new Date(now.getTime() + RESET_HOURS * 3_600_000), createdById: actor.id } }),
  ]);
  return token;
}

export async function resetTokenValid(token: string, now = new Date()) {
  const t = await prisma.portalToken.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!t && !t.usedAt && t.expiresAt > now && t.purpose === "PASSWORD_RESET";
}

/** Set a new password with a reset link; signs out every other session. */
export async function resetPassword(token: string, password: string, now = new Date()) {
  passwordOrThrow(password);
  const t = await prisma.portalToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } });
  if (!t || t.usedAt || t.expiresAt <= now || t.purpose !== "PASSWORD_RESET" || t.account.status !== "ACTIVE") throw new UserError("This link has expired or was already used. Ask us for a new one.");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.portalToken.update({ where: { id: t.id }, data: { usedAt: now } }),
    prisma.portalAccount.update({ where: { id: t.accountId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
    prisma.portalSession.deleteMany({ where: { accountId: t.accountId } }),
  ]);
  return t.accountId;
}

// ───────────────────────── Staff review ─────────────────────────

/** Existing customers with the sign-up's phone number (any stored format). */
export function matchingCustomers(phone: string) {
  return prisma.customer.findMany({ where: { phone: { in: phoneVariants(phone) } }, select: { id: true, code: true, name: true, phone: true, address: true } });
}

/**
 * Approve a sign-up: link it to `customerId` (an existing customer) or, with
 * "new", create a customer from the sign-up details.
 */
export async function approveAccount(actor: Actor, accountId: string, customerId: string | "new") {
  assertCan(actor.role, "request:edit");
  const acc = await prisma.portalAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new UserError("Account not found");
  if (acc.status !== "PENDING") throw new UserError("This sign-up was already reviewed");
  await prisma.$transaction(async (tx) => {
    let cid: string;
    if (customerId === "new") {
      if ((await tx.customer.count({ where: { phone: { in: phoneVariants(acc.phone) } } })) > 0) throw new UserError("A customer with this phone already exists – link the account to that customer");
      const c = await findOrCreateCustomer(tx, { name: acc.name, phone: acc.phone, email: acc.email ?? undefined, address: acc.address, district: acc.district ?? undefined, area: acc.area ?? undefined }, actor.id);
      await logChanges(tx, { entityType: "Customer", entityId: c.id, userId: actor.id, action: "CREATE" });
      cid = c.id;
    } else {
      const c = await tx.customer.findUnique({ where: { id: customerId } });
      if (!c) throw new UserError("Customer not found");
      cid = c.id;
    }
    await tx.portalAccount.update({ where: { id: accountId }, data: { status: "ACTIVE", customerId: cid, reviewedById: actor.id, reviewedAt: new Date() } });
    await logChanges(tx, { entityType: "PortalAccount", entityId: accountId, userId: actor.id, action: "UPDATE", changes: [{ field: "status", oldValue: "PENDING", newValue: "ACTIVE" }] });
  });
}

export async function rejectAccount(actor: Actor, accountId: string, reason: string) {
  assertCan(actor.role, "request:edit");
  const acc = await prisma.portalAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new UserError("Account not found");
  if (acc.status !== "PENDING") throw new UserError("This sign-up was already reviewed");
  await prisma.$transaction([
    prisma.portalAccount.update({ where: { id: accountId }, data: { status: "REJECTED", rejectReason: reason, reviewedById: actor.id, reviewedAt: new Date() } }),
    prisma.auditLog.create({ data: { entityType: "PortalAccount", entityId: accountId, userId: actor.id, action: "UPDATE", field: "status", oldValue: "PENDING", newValue: "REJECTED" } }),
  ]);
}

/** Disable (logs out everywhere at once) or re-enable an approved account. */
export async function setAccountDisabled(actor: Actor, accountId: string, disabled: boolean) {
  assertCan(actor.role, "request:edit");
  const acc = await prisma.portalAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new UserError("Account not found");
  const from = disabled ? "ACTIVE" : "DISABLED";
  if (acc.status !== from) throw new UserError(disabled ? "Only active accounts can be disabled" : "This account is not disabled");
  const to = disabled ? "DISABLED" : "ACTIVE";
  await prisma.$transaction([
    prisma.portalAccount.update({ where: { id: accountId }, data: { status: to } }),
    ...(disabled ? [prisma.portalSession.deleteMany({ where: { accountId } })] : []),
    prisma.auditLog.create({ data: { entityType: "PortalAccount", entityId: accountId, userId: actor.id, action: "UPDATE", field: "status", oldValue: from, newValue: to } }),
  ]);
}

export function listPortalAccounts(status?: PortalAccountStatus) {
  return prisma.portalAccount.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      phone: true,
      name: true,
      email: true,
      address: true,
      district: true,
      area: true,
      status: true,
      rejectReason: true,
      lastLoginAt: true,
      createdAt: true,
      reviewedAt: true,
      reviewedBy: { select: { name: true } },
      customer: { select: { id: true, code: true, name: true } },
    },
  });
}
