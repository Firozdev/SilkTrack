"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab bar for the Settings section. */
export function SettingsTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active ? "border-blue-600 font-semibold text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
