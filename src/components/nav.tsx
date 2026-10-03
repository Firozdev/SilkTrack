"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700 hover:bg-gray-100"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
