import type { Role } from "@/generated/prisma/enums";

/**
 * Who is told about what – the one place to change recipients.
 *
 * roles:    staff roles notified (every active user with that role).
 * customer: the customer's own portal login and their agent, if any.
 * channels: where it goes. Only IN_APP is delivered today; SMS / WHATSAPP /
 *           EMAIL can be added here later without touching the callers.
 *
 * Nobody is notified about their own action.
 */
export type Channel = "IN_APP" | "SMS" | "WHATSAPP" | "EMAIL";
export type Rule = { roles: Role[]; customer?: boolean; channels: Channel[] };

const R = (roles: Role[], customer = false): Rule => ({ roles, customer, channels: ["IN_APP"] });

export const RULES = {
  // ── Requests ──
  BUY_REQUEST_NEW: R(["ADMIN", "PURCHASE", "CS"], true),
  SHIP_REQUEST_NEW: R(["ADMIN", "PURCHASE", "CS"], true),
  QA_REQUESTED: R(["PURCHASE"]),
  PORTAL_REQUEST_EDITED: R(["CS", "ADMIN", "PURCHASE"]),
  PORTAL_REQUEST_CANCELLED: R(["CS", "ADMIN", "PURCHASE"]),
  PORTAL_SHIPPING_EDITED: R(["CS", "ADMIN", "PURCHASE"]),
  PORTAL_SHIPPING_CANCELLED: R(["CS", "ADMIN", "PURCHASE"]),
  COMMENT_FROM_CHINA: R(["CS", "ADMIN"]),
  COMMENT_FROM_BD: R(["PURCHASE"]),

  // ── Quotations ──
  QUOTE_SUBMITTED: R(["CS", "ADMIN"]),
  QUOTE_SENT: R([], true),
  QUOTE_DECIDED: R(["CS", "ADMIN"]),
  QUOTE_REVISION_REQUESTED: R(["PURCHASE"]),
  APPROVED_FOR_PURCHASE: R(["PURCHASE"]),
  UPFRONT_PAYMENT_REQUESTED: R(["CS", "ADMIN"]),
  PURCHASE_RELEASED: R(["PURCHASE"]),

  // ── Purchasing (China) ──
  PRICE_APPROVAL_NEEDED: R(["ADMIN", "CS"]),
  PRICE_APPROVAL_RESULT: R(["PURCHASE"]),
  PURCHASED: R(["CS", "ADMIN"], true),
  PURCHASE_PROBLEM: R(["CS", "ADMIN"]),

  // ── China warehouse ──
  RECEIVED_CHINA: R(["CS", "ADMIN"], true),
  QA_PASSED: R(["CS", "ADMIN"], true),
  QA_FAILED: R(["ADMIN", "CS"], true),
  ASSIGNED_TO_SHIPMENT: R([], true),

  // ── Shipments ──
  SHIPMENT_DEPARTED: R([], true),
  SHIPMENT_IN_TRANSIT: R([], true),
  SHIPMENT_ARRIVED: R(["ADMIN", "CS"]),
  ARRIVED_BD: R([], true),
  CUSTOMS_CLEARED: R([], true),

  // ── Billing and delivery ──
  INVOICE_READY: R([], true),
  PAYMENT_SUBMITTED: R(["ADMIN", "CS"]),
  PAYMENT_CONFIRMED: R(["CS"], true),
  PAYMENT_COLLECTED: R([], true),
  READY_FOR_DELIVERY: R([], true),
  OUT_FOR_DELIVERY: R([], true),
  DELIVERED: R([], true),
  CUSTOMER_CONFIRMED_RECEIPT: R(["CS"]),
  CUSTOMER_PROBLEM_REPORTED: R(["CS", "ADMIN"]),

  // ── Issues ──
  ISSUE_REPORTED: R(["ADMIN", "CS", "PURCHASE"], true),
  ISSUE_RESOLVED: R(["CS", "ADMIN"], true),

  // ── Samples ──
  SAMPLE_REQUESTED: R(["PURCHASE"]),
  SAMPLE_INVOICED: R(["CS", "ADMIN"]),
  SAMPLE_PAID: R(["PURCHASE"]),
  SAMPLE_PURCHASED: R(["CS"]),
  SAMPLE_SHIPPED: R(["CS", "ADMIN"]),
  SAMPLE_DELIVERED: R(["PURCHASE"]),

  // ── Accounts and settings ──
  PORTAL_SIGNUP: R(["CS", "ADMIN"]),
  AGENT_CUSTOMER_ADDED: R(["CS", "ADMIN"]),
  RATE_MISSING: R(["ADMIN"]),
} satisfies Record<string, Rule>;

export type EventType = keyof typeof RULES;
export const EVENT_TYPES = Object.keys(RULES) as EventType[];
