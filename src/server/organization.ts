import "server-only";
import type { PaymentAccountType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { saveLogo, type StoredLogo } from "@/lib/uploads";
import type { Actor } from "./actor";

/**
 * Organization details and payment accounts (Settings → Organization /
 * Payment information, Admin only). The single source for every PDF:
 * templates use getDocumentBranding(), never hard-coded text.
 */
export type Organization = { name: string; tagline: string; phone: string; email: string; website: string; address: string; logo: StoredLogo | null };

const KEY = "organization";
const EMPTY: Organization = { name: "", tagline: "", phone: "", email: "", website: "", address: "", logo: null };

export async function getOrganization(): Promise<Organization> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...EMPTY, ...((row?.value as Partial<Organization> | null) ?? {}) };
}

export type OrganizationInput = Omit<Organization, "logo">;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin saves the details; `logo` replaces the current one, `removeLogo` clears it. Changes are audit-logged. */
export async function saveOrganization(actor: Actor, input: OrganizationInput, opts: { logo?: File | null; removeLogo?: boolean } = {}) {
  assertCan(actor.role, "settings:manage");
  const clean = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, (v ?? "").trim()])) as OrganizationInput;
  if (!clean.name) throw new UserError("Enter the organization name");
  if (clean.email && !EMAIL.test(clean.email)) throw new UserError("Enter a valid email address");
  if (clean.website && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(clean.website)) throw new UserError("Enter a valid website, e.g. www.example.com");
  const before = await getOrganization();
  const logo = opts.logo && opts.logo.size > 0 ? await saveLogo(opts.logo) : opts.removeLogo ? null : before.logo;
  const after: Organization = { ...clean, logo };
  const changes = (Object.keys(after) as (keyof Organization)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => (k === "logo" ? { field: "logo", oldValue: before.logo?.fileName ?? null, newValue: after.logo?.fileName ?? null } : { field: k, oldValue: before[k] as string, newValue: after[k] as string }));
  if (!changes.length) return after;
  await prisma.$transaction(async (tx) => {
    const value = after as unknown as Prisma.InputJsonObject;
    await tx.setting.upsert({ where: { key: KEY }, update: { value, updatedById: actor.id }, create: { key: KEY, value, updatedById: actor.id, description: "Organization details for PDFs" } });
    await logChanges(tx, { entityType: "Setting", entityId: KEY, userId: actor.id, action: "UPDATE", changes });
  });
  return after;
}

// ───────────────────────── Payment accounts ─────────────────────────

export type PaymentAccountInput = {
  type: PaymentAccountType;
  providerName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
  routingNumber?: string;
  notes?: string;
  showOnPdf: boolean;
};

export function listPaymentAccounts() {
  return prisma.paymentAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

function cleanAccount(i: PaymentAccountInput) {
  const data = {
    type: i.type,
    providerName: i.providerName.trim(),
    accountName: i.accountName.trim(),
    accountNumber: i.accountNumber.trim(),
    branch: i.branch?.trim() || null,
    routingNumber: i.routingNumber?.trim() || null,
    notes: i.notes?.trim() || null,
    showOnPdf: i.showOnPdf,
  };
  if (!data.providerName || !data.accountName || !data.accountNumber) throw new UserError("Enter the bank / provider name, account name and account number");
  return data;
}

export async function createPaymentAccount(actor: Actor, input: PaymentAccountInput) {
  assertCan(actor.role, "settings:manage");
  const data = cleanAccount(input);
  const last = await prisma.paymentAccount.aggregate({ _max: { sortOrder: true } });
  return prisma.$transaction(async (tx) => {
    const a = await tx.paymentAccount.create({ data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    await logChanges(tx, { entityType: "PaymentAccount", entityId: a.id, userId: actor.id, action: "CREATE" });
    return a;
  });
}

export async function updatePaymentAccount(actor: Actor, id: string, input: PaymentAccountInput) {
  assertCan(actor.role, "settings:manage");
  const before = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!before) throw new UserError("Account not found");
  const data = cleanAccount(input);
  const changes = (Object.keys(data) as (keyof typeof data)[]).filter((k) => before[k] !== data[k]).map((k) => ({ field: k, oldValue: before[k], newValue: data[k] }));
  if (!changes.length) return before;
  return prisma.$transaction(async (tx) => {
    const a = await tx.paymentAccount.update({ where: { id }, data });
    await logChanges(tx, { entityType: "PaymentAccount", entityId: id, userId: actor.id, action: "UPDATE", changes });
    return a;
  });
}

export async function setShowOnPdf(actor: Actor, id: string, show: boolean) {
  assertCan(actor.role, "settings:manage");
  const before = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!before) throw new UserError("Account not found");
  if (before.showOnPdf === show) return;
  await prisma.$transaction(async (tx) => {
    await tx.paymentAccount.update({ where: { id }, data: { showOnPdf: show } });
    await logChanges(tx, { entityType: "PaymentAccount", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "showOnPdf", oldValue: before.showOnPdf, newValue: show }] });
  });
}

export async function deletePaymentAccount(actor: Actor, id: string) {
  assertCan(actor.role, "settings:manage");
  const before = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!before) throw new UserError("Account not found");
  await prisma.$transaction(async (tx) => {
    await tx.paymentAccount.delete({ where: { id } });
    await logChanges(tx, { entityType: "PaymentAccount", entityId: id, userId: actor.id, action: "DELETE", changes: [{ field: "account", oldValue: `${before.providerName} ${before.accountNumber}`, newValue: null }] });
  });
}

/** Move one place up or down; positions are renumbered 1..n. */
export async function movePaymentAccount(actor: Actor, id: string, direction: "up" | "down") {
  assertCan(actor.role, "settings:manage");
  const list = await listPaymentAccounts();
  const i = list.findIndex((a) => a.id === id);
  if (i === -1) throw new UserError("Account not found");
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await prisma.$transaction(async (tx) => {
    for (const [n, a] of list.entries()) if (a.sortOrder !== n + 1) await tx.paymentAccount.update({ where: { id: a.id }, data: { sortOrder: n + 1 } });
    await logChanges(tx, { entityType: "PaymentAccount", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "sortOrder", oldValue: i + 1, newValue: j + 1 }] });
  });
}

// ───────────────────────── For PDF templates ─────────────────────────

export type DocumentBranding = {
  org: Organization;
  /** Logo URL for <img>, or null. Changes when the logo is replaced (no stale cache). */
  logoUrl: string | null;
  /** Accounts marked "Show on PDFs", in the order Admin set. */
  accounts: Awaited<ReturnType<typeof listPaymentAccounts>>;
};

/** The one helper every PDF template (invoice, quote, payment receipt) uses for organization + payment details. */
export async function getDocumentBranding(): Promise<DocumentBranding> {
  const [org, accounts] = await Promise.all([getOrganization(), prisma.paymentAccount.findMany({ where: { showOnPdf: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })]);
  return { org, logoUrl: org.logo ? `/api/org/logo?v=${encodeURIComponent(org.logo.key)}` : null, accounts };
}
