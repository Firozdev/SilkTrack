import type { ReactNode } from "react";
import { fmtDateTime } from "@/lib/dates";
import type { Lang } from "./i18n";
import { portalLabel } from "./labels";

const DONE = new Set(["DELIVERED", "PAID", "APPROVED", "CUSTOMER_APPROVED"]);
const BAD = new Set(["CANCELLED", "REJECTED"]);
const WAIT = new Set(["ON_HOLD", "INVOICED", "AWAITING_PAYMENT", "QUOTED", "SENT_TO_CUSTOMER", "ISSUED", "PARTIALLY_PAID"]);

export function PStatus({ value, lang }: { value: string; lang: Lang }) {
  const cls = DONE.has(value)
    ? "bg-green-50 text-green-700 ring-green-200"
    : BAD.has(value)
      ? "bg-red-50 text-red-700 ring-red-200"
      : WAIT.has(value)
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-blue-50 text-blue-700 ring-blue-200";
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{portalLabel(value, lang)}</span>;
}

/** Status timeline: one row per status change, newest last. */
export function Timeline({ events, tz, lang }: { events: { id: string; status: string | null; occurredAt: Date; note?: ReactNode }[]; tz: string; lang: Lang }) {
  return (
    <ol className="space-y-2 border-l border-gray-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
          <div className="text-xs text-gray-500">{fmtDateTime(e.occurredAt, tz)}</div>
          <div>
            {e.status && <b>{portalLabel(e.status, lang)}</b>} {e.note}
          </div>
        </li>
      ))}
    </ol>
  );
}
