import type { ReactNode } from "react";
import { Card } from "./ui";

/** A record's notifications, newest first (staff and portal order pages). */
export function NotificationHistory({ title, empty, items, fmt, customerTag }: { title: string; empty: string; items: { id: string; title: string; body: string; at: Date; toCustomer: boolean }[]; fmt: (d: Date) => string; customerTag?: ReactNode }) {
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {items.map((e) => (
            <li key={e.id} className="border-l-2 border-blue-200 pl-3">
              <div className="text-gray-900">
                {e.title}
                {customerTag && e.toCustomer && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">{customerTag}</span>}
              </div>
              {e.body && <div className="text-gray-500">{e.body}</div>}
              <div className="text-xs text-gray-400">{fmt(e.at)}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
