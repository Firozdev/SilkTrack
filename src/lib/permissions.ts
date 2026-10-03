import type { Role } from "@/generated/prisma/enums";

/**
 * What each role may do. Based on the roles table in docs/requirements.md.
 * Screens and server actions must check these; hiding a button is not enough.
 */
export const ACTIONS = [
  "user:manage",
  "settings:manage",
  "rate:edit",
  "request:edit",
  "quote:edit",
  "estimate:edit", // China prepares RMB estimate
  "estimate:review", // BD reviews and sends to customer
  "purchase:edit",
  "purchase:approvePriceChange",
  "receiving:edit",
  "shipment:edit",
  "shipment:manage", // create/close/change status of weekly shipments
  "tracking:edit",
  "payment:record",
  "invoice:view",
  "invoice:edit",
  "bdReceiving:edit",
  "delivery:edit",
  "notification:manage",
  "audit:view",
  "report:profit",
  "price:viewSelling", // BDT selling price, margin, profit (PURCHASE: selling only via User.canSetSellingPrice)
  "cost:viewChina", // RMB cost
] as const;

export type Action = (typeof ACTIONS)[number];

const ROLE_ACTIONS: Record<Role, ReadonlySet<Action>> = {
  ADMIN: new Set(ACTIONS),
  CS: new Set<Action>([
    "request:edit",
    "quote:edit",
    "estimate:review",
    "purchase:approvePriceChange",
    "payment:record",
    "invoice:view",
    "price:viewSelling",
    "cost:viewChina",
  ]),
  PURCHASE: new Set<Action>([
    "estimate:edit",
    "purchase:edit",
    "receiving:edit",
    "shipment:edit",
    "tracking:edit",
    "cost:viewChina",
  ]),
};

export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role].has(action);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Not allowed: ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}

/** Who is looking at the data. `canSetSellingPrice` only matters for PURCHASE users. */
export type Viewer = { role: Role; canSetSellingPrice?: boolean };

/**
 * May this viewer see and set customer selling prices (BDT)? Always for
 * ADMIN/CS; for PURCHASE only when Admin enabled it for that user.
 */
export function canSeeSelling(v: Viewer): boolean {
  return can(v.role, "price:viewSelling") || (v.role === "PURCHASE" && !!v.canSetSellingPrice);
}

/** Profit / margin and customer billing – never shown to PURCHASE. */
export const PROFIT_FIELDS: ReadonlySet<string> = new Set(["marginBdt", "profitBdt", "invoices", "invoice", "payments"]);
/** Customer selling price – shown to PURCHASE only with canSetSellingPrice. */
export const SELLING_FIELDS: ReadonlySet<string> = new Set(["sellingPriceBdt", "grandTotalBdt"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function strip(value: unknown, hidden: (key: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, hidden));
  // Leave Decimal, Date, etc. untouched.
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (hidden(key)) continue;
    out[key] = strip(v, hidden);
  }
  return out;
}

/**
 * Remove data the viewer may not see before it leaves the server: profit,
 * margin and billing for every PURCHASE user; selling prices too unless the
 * user has canSetSellingPrice.
 */
export function redactFor<T>(viewer: Viewer, data: T): T {
  if (can(viewer.role, "price:viewSelling")) return data;
  const selling = canSeeSelling(viewer);
  return strip(data, (k) => PROFIT_FIELDS.has(k) || (!selling && SELLING_FIELDS.has(k))) as T;
}

/** Role-only variant (no per-user permission). */
export function redactForRole<T>(role: Role, data: T): T {
  return redactFor({ role }, data);
}
