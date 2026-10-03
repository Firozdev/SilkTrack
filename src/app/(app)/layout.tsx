import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/session";
import { navFor } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentRate } from "@/server/rates";
import { fmtRate } from "@/lib/format";
import { fmtDay } from "@/lib/dates";
import { logout } from "./actions";

const ROLE_LABEL = { ADMIN: "Admin", CS: "CS · Bangladesh", PURCHASE: "Purchase · China" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [{ rate, isToday }, unread] = await Promise.all([
    getCurrentRate(),
    prisma.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
  ]);

  return (
    // App shell fills the viewport: header, banner and menu stay put; only <main> scrolls.
    // In print the shell becomes normal flow so quotes/invoices print in full.
    <div className="flex h-dvh flex-col overflow-hidden bg-gray-50 print:block print:h-auto print:overflow-visible print:bg-white">
      <header className="no-print flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <Link href="/" className="text-lg font-semibold text-gray-900">
          SilkTrack
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-gray-500 sm:inline">
            1 RMB = <b className="text-gray-800">{rate ? fmtRate(rate.rate) : "—"}</b> BDT
          </span>
          <Link href="/notifications" className="relative rounded-md px-2 py-1 text-gray-700 hover:bg-gray-100" aria-label={`${unread} unread notifications`}>
            🔔
            {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
          </Link>
          <span className="hidden text-gray-700 sm:inline">
            {user.name} <span className="text-gray-400">({ROLE_LABEL[user.role]})</span>
          </span>
          <form action={logout}>
            <button className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Sign out</button>
          </form>
        </div>
      </header>
      {!isToday && (
        <div className="no-print shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
          ⚠ No exchange rate entered for today.{" "}
          {rate ? (
            <>
              Using the last rate <b>{fmtRate(rate.rate)}</b> from {fmtDay(rate.effectiveDate)}.
            </>
          ) : (
            <>No rate exists yet – prices cannot be converted.</>
          )}{" "}
          {user.role === "ADMIN" && (
            <Link href="/rates" className="font-semibold underline">
              Enter today&apos;s rate
            </Link>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row print:block">
        <aside className="no-print shrink-0 border-b border-gray-200 bg-white px-2 py-2 md:w-52 md:overflow-y-auto md:border-b-0 md:border-r md:py-4">
          <Nav items={navFor(user.role)} />
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
