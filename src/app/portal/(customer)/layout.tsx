import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { requirePortalAccount } from "@/lib/portal-session";
import { NotificationBell } from "@/components/notification-bell";
import { portalLogoutAction, portalMarkAllReadAction, portalMarkReadAction, portalSetSoundAction } from "../actions";
import { getDict } from "../lang";
import { LangSwitch } from "../lang-switch";
import { Logo } from "@/components/logo";

export const metadata = { title: "SilkTruck customer portal" };

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  return (
    <div lang={lang} className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link href="/portal" className="text-lg font-semibold text-gray-900">
            <Logo name={t.brand} />
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <Link href="/portal" className="rounded-md px-2 py-1 hover:bg-gray-100">
              {t.myOrders}
            </Link>
            <Link href="/portal/requests/new" className="rounded-md px-2 py-1 hover:bg-gray-100">
              {t.buyForMe}
            </Link>
            <Link href="/portal/shipping/new" className="rounded-md px-2 py-1 hover:bg-gray-100">
              {t.shipMyGoods}
            </Link>
            <span className="hidden px-2 text-gray-500 sm:inline">
              {acc.kind === "AGENT" ? `${acc.name} · ${t.agentTag}` : `${acc.customer.name} (${acc.customer.code})`}
            </span>
            <NotificationBell
              feedUrl="/portal/api/notifications"
              viewAllHref="/portal/notifications"
              soundOn={acc.notifySound}
              labels={{ notifications: t.notifications, markAllRead: t.markAllRead, viewAll: t.viewAll, empty: t.noNotifications, sound: t.sound, justNow: t.justNow, minAgo: t.minAgo, hAgo: t.hAgo, dAgo: t.dAgo }}
              markRead={portalMarkReadAction}
              markAllRead={portalMarkAllReadAction}
              setSound={portalSetSoundAction}
            />
            <Suspense>
              <LangSwitch lang={lang} label={t.language} />
            </Suspense>
            <form action={portalLogoutAction}>
              <button className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">{t.logOut}</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
    </div>
  );
}
