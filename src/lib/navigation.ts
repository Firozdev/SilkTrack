import type { Role } from "@/generated/prisma/enums";
import { can, type Action } from "./permissions";

/** Sections the BD warehouse doesn't use (prices, costs, purchasing, settings) – hidden and blocked. */
export const OFFICE_ROLES: Role[] = ["ADMIN", "CS", "PURCHASE"];
export const SECTION_ROLES = {
  quotations: OFFICE_ROLES,
  samples: OFFICE_ROLES,
  purchasing: ["ADMIN", "PURCHASE", "CS"],
  receiving: ["ADMIN", "PURCHASE"],
  settings: OFFICE_ROLES,
} as const satisfies Record<string, Role[]>;
export type Section = keyof typeof SECTION_ROLES;

const ITEMS: { href: string; label: string; need?: Action; roles?: readonly Role[] }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/estimates", label: "Quotations", roles: SECTION_ROLES.quotations },
  { href: "/samples", label: "Samples", roles: SECTION_ROLES.samples },
  { href: "/shipping-orders", label: "Shipping service" },
  { href: "/purchasing", label: "Purchasing", roles: SECTION_ROLES.purchasing },
  { href: "/receiving", label: "China receiving", roles: SECTION_ROLES.receiving },
  { href: "/shipments", label: "Shipments" },
  { href: "/issues", label: "Issues" },
  { href: "/customers", label: "Customers", need: "request:edit" },
  { href: "/agents", label: "Agents", need: "agent:manage" },
  { href: "/payments-to-verify", label: "Payments to verify", need: "payment:record" },
  { href: "/settings", label: "Settings", roles: SECTION_ROLES.settings },
];

export const canOpenSection = (role: Role, section: Section) => (SECTION_ROLES[section] as readonly Role[]).includes(role);

export function navFor(role: Role) {
  return ITEMS.filter((i) => (!i.need || can(role, i.need)) && (!i.roles || i.roles.includes(role))).map(({ href, label }) => ({ href, label }));
}
