import "server-only";
import { randomInt } from "node:crypto";
import type { Locale, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/password";
import { ROLE_DEFAULTS } from "@/lib/roles";
import type { Actor } from "./actor";

/**
 * Staff logins (Admin, CS, China team, BD Warehouse), managed by Admin in
 * Settings → Users. Users are disabled, never deleted, so their history stays.
 * There is always at least one active Admin, and nobody can lock themselves out.
 */

export const STAFF_ROLES: Role[] = ["ADMIN", "CS", "PURCHASE", "BD_WAREHOUSE"];
const LOCALES: Locale[] = ["EN", "BN", "ZH_CN"];

export function listStaff() {
  return prisma.user.findMany({
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, timezone: true, locale: true, canSetSellingPrice: true, createdAt: true },
  });
}

/** A readable one-time password, e.g. "Rk7-mpq4-Tz9w". */
export function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");
  return `${pick(3)}-${pick(4)}-${pick(4)}`;
}

const cleanEmail = (e: string) => {
  const v = e.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new UserError("Enter a valid email address");
  return v;
};
const cleanName = (n: string) => {
  const v = n.trim();
  if (!v) throw new UserError("Enter the name");
  return v.slice(0, 100);
};
function checkRole(role: string): asserts role is Role {
  if (!(STAFF_ROLES as string[]).includes(role)) throw new UserError("Choose a role");
}
function checkPassword(p: string) {
  if (p.length < MIN_PASSWORD_LENGTH) throw new UserError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}
async function emailFree(email: string, exceptId?: string) {
  const other = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== exceptId) throw new UserError("Another user already has this email");
}

export type NewStaff = { name: string; email: string; role: string; password?: string; canSetSellingPrice?: boolean; timezone?: string; locale?: string };

/** Returns the password to hand over (the one typed, or a generated one). */
export async function createStaff(actor: Actor, input: NewStaff) {
  assertCan(actor.role, "user:manage");
  checkRole(input.role);
  const email = cleanEmail(input.email);
  await emailFree(email);
  const password = input.password?.trim() || generatePassword();
  checkPassword(password);
  const d = ROLE_DEFAULTS[input.role];
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: cleanName(input.name),
        email,
        role: input.role as Role,
        passwordHash: await hashPassword(password),
        timezone: input.timezone?.trim() || d.timezone,
        locale: (LOCALES as string[]).includes(input.locale ?? "") ? (input.locale as Locale) : d.locale,
        canSetSellingPrice: input.role === "PURCHASE" && !!input.canSetSellingPrice,
      },
    });
    await logChanges(tx, {
      entityType: "User",
      entityId: u.id,
      userId: actor.id,
      action: "CREATE",
      changes: [
        { field: "email", oldValue: null, newValue: u.email },
        { field: "role", oldValue: null, newValue: u.role },
      ],
    });
    return u;
  });
  return { user, password };
}

/** At least one other active Admin must remain when this user stops being an active Admin. */
async function keepAnAdmin(userId: string) {
  const others = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: userId } } });
  if (others === 0) throw new UserError("There must always be at least one active Admin");
}

export type StaffEdit = { name: string; email: string; role: string; canSetSellingPrice?: boolean; timezone: string; locale: string };

export async function updateStaff(actor: Actor, id: string, input: StaffEdit) {
  assertCan(actor.role, "user:manage");
  checkRole(input.role);
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new UserError("User not found");
  const email = cleanEmail(input.email);
  await emailFree(email, id);
  if (u.role === "ADMIN" && input.role !== "ADMIN") {
    if (id === actor.id) throw new UserError("You can't remove your own Admin role");
    if (u.active) await keepAnAdmin(id);
  }
  if (!(LOCALES as string[]).includes(input.locale)) throw new UserError("Choose a language");
  const data = {
    name: cleanName(input.name),
    email,
    role: input.role as Role,
    canSetSellingPrice: input.role === "PURCHASE" && !!input.canSetSellingPrice,
    timezone: input.timezone.trim() || ROLE_DEFAULTS[input.role].timezone,
    locale: input.locale as Locale,
  };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data });
    const changes = (["name", "email", "role", "canSetSellingPrice", "timezone", "locale"] as const)
      .filter((k) => String(u[k]) !== String(data[k]))
      .map((k) => ({ field: k, oldValue: String(u[k]), newValue: String(data[k]) }));
    if (changes.length) await logChanges(tx, { entityType: "User", entityId: id, userId: actor.id, action: "UPDATE", changes });
  });
}

/** Disable (logged out on their next click, can't log in) or enable again. */
export async function setStaffActive(actor: Actor, id: string, active: boolean) {
  assertCan(actor.role, "user:manage");
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new UserError("User not found");
  if (u.active === active) return;
  if (!active) {
    if (id === actor.id) throw new UserError("You can't disable your own login");
    if (u.role === "ADMIN") await keepAnAdmin(id);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { active } });
    await logChanges(tx, { entityType: "User", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "active", oldValue: String(u.active), newValue: String(active) }] });
  });
}

/** Returns the new password to hand over (typed or generated). Logged without the password. */
export async function resetStaffPassword(actor: Actor, id: string, typed?: string) {
  assertCan(actor.role, "user:manage");
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!u) throw new UserError("User not found");
  const password = typed?.trim() || generatePassword();
  checkPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await logChanges(tx, { entityType: "User", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "password", oldValue: null, newValue: "reset" }] });
  });
  return password;
}

/** Customers and agents (portal logins) for the Portal tab. */
export function listPortalLogins() {
  return prisma.portalAccount.findMany({
    orderBy: [{ kind: "asc" }, { status: "asc" }, { name: "asc" }],
    select: { id: true, kind: true, name: true, phone: true, status: true, lastLoginAt: true, createdAt: true, customer: { select: { id: true, code: true } } },
  });
}
