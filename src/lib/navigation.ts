import type { Role } from "@/generated/prisma/enums";
import { can, type Action } from "./permissions";

const ITEMS: { href: string; label: string; need?: Action; roles?: Role[] }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/estimates", label: "Quotations" },
  { href: "/samples", label: "Samples" },
  { href: "/shipping-orders", label: "Shipping service" },
  { href: "/purchasing", label: "Purchasing", roles: ["ADMIN", "PURCHASE", "CS"] },
  { href: "/receiving", label: "China receiving", roles: ["ADMIN", "PURCHASE"] },
  { href: "/shipments", label: "Shipments" },
  { href: "/issues", label: "Issues" },
  { href: "/customers", label: "Customers", need: "request:edit" },
  { href: "/agents", label: "Agents", need: "agent:manage" },
  { href: "/payments-to-verify", label: "Payments to verify", need: "payment:record" },
  { href: "/settings", label: "Settings" },
];

export function navFor(role: Role) {
  return ITEMS.filter((i) => (!i.need || can(role, i.need)) && (!i.roles || i.roles.includes(role))).map(({ href, label }) => ({ href, label }));
}
