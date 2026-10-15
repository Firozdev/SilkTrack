import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireSection } from "@/lib/session";
import { SettingsTabs } from "./settings-tabs";

/** Settings section: exchange rates (everyone can view); shipping charges, organization, payment information and general rules (Admin). */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireSection("settings");
  const admin = can(user.role, "settings:manage");
  const tabs = [
    { href: "/settings/exchange-rates", label: "Exchange rates" },
    ...(admin
      ? [
          { href: "/settings/shipping-charges", label: "Shipping charges" },
          { href: "/settings/organization", label: "Organization" },
          { href: "/settings/payment-accounts", label: "Payment information" },
          { href: "/settings", label: "General" },
        ]
      : []),
    ...(can(user.role, "user:manage") ? [{ href: "/settings/users", label: "Users" }] : []),
  ];
  return (
    <>
      <PageHeader title="Settings" subtitle={admin ? "Only Admin can change these. Every change is in the audit log." : "Exchange rates are set by Admin."} />
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
