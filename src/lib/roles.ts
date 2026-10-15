import type { Role } from "@/generated/prisma/enums";

/** Staff role names shown on screen. */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  CS: "CS · Bangladesh",
  PURCHASE: "China team",
  BD_WAREHOUSE: "BD Warehouse",
};

/** What each role does, in plain words (Settings → Users). */
export const ROLE_SUMMARY: Record<Role, string[]> = {
  ADMIN: ["Everything: settings, users, exchange rates, profit reports", "Money steps (final invoice shared, payment collected) and moving a stage back"],
  CS: ["Customer requests, quotes to customers, payments and payment checks", "Ship for Me invoices; sees selling prices"],
  PURCHASE: ["China quotations, purchasing, China warehouse receiving and loading shipments", "Sees RMB costs; selling prices only if allowed per user"],
  BD_WAREHOUSE: [
    "Shipment arrived in Bangladesh / customs cleared / completed",
    "Orders: Bangladesh received, customs clearance, ready for home delivery, out for delivery, delivered",
    "Ship for Me: received in Bangladesh, dispatch to courier, delivered",
    "Sees orders and addresses – no prices, costs, money steps or settings",
  ],
};

/** Default time zone / language for a new user of this role. */
export const ROLE_DEFAULTS: Record<Role, { timezone: string; locale: "EN" | "ZH_CN" }> = {
  ADMIN: { timezone: "Asia/Dhaka", locale: "EN" },
  CS: { timezone: "Asia/Dhaka", locale: "EN" },
  PURCHASE: { timezone: "Asia/Shanghai", locale: "ZH_CN" },
  BD_WAREHOUSE: { timezone: "Asia/Dhaka", locale: "EN" },
};
