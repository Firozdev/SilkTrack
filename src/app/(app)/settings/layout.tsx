import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { SettingsTabs } from "./settings-tabs";

/** Settings section: exchange rates (everyone can view), shipping charges and general rules (Admin). */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const admin = can(user.role, "settings:manage");
  const tabs = [
    { href: "/settings/exchange-rates", label: "Exchange rates" },
    ...(admin
      ? [
          { href: "/settings/shipping-charges", label: "Shipping charges" },
          { href: "/settings", label: "General" },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader title="Settings" subtitle={admin ? "Only Admin can change these. Every change is in the audit log." : "Exchange rates are set by Admin."} />
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
