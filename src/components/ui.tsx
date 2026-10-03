import Link from "next/link";
import type { ReactNode } from "react";
import { humanize } from "@/lib/format";

export const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none disabled:bg-gray-100";
export const btnCls =
  "inline-flex items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50";
export const btnPrimaryCls =
  "inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
export const btnDangerCls =
  "inline-flex items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";
export const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
export const tdCls = "px-3 py-2 align-top text-sm";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-gray-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-gray-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

/** Label/value pairs. */
export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-50 py-1 sm:block sm:border-0 sm:py-0">
          <dt className="text-gray-500">{k}</dt>
          <dd className="text-right font-medium text-gray-900 sm:text-left">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const GREEN = new Set(["DELIVERED", "COMPLETED", "APPROVED", "CUSTOMER_APPROVED", "PAID", "RECEIVED", "OK", "RESOLVED", "CLOSED", "READY_TO_SHIP", "RECEIVED_AT_CHINA_WAREHOUSE", "SENT", "READ", "CUSTOMS_CLEARED", "NOT_REQUIRED"]);
const RED = new Set(["CANCELLED", "REJECTED", "DAMAGED", "MISSING", "WRONG_ITEM", "SHORT", "OUT_OF_STOCK", "FAILED", "OPEN_ISSUE", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER", "RETURNED", "WEIGHT_MISMATCH"]);
const AMBER = new Set(["ON_HOLD", "PENDING", "NEW", "DRAFT", "UPCOMING", "QUOTED", "REQUESTED", "REVISED", "PARTIALLY_PAID", "ISSUED", "IN_PROGRESS"]);

export function Badge({ value, label }: { value: string; label?: string }) {
  const cls = GREEN.has(value)
    ? "bg-green-50 text-green-700 ring-green-200"
    : RED.has(value)
      ? "bg-red-50 text-red-700 ring-red-200"
      : AMBER.has(value)
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-blue-50 text-blue-700 ring-blue-200";
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {label ?? humanize(value)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-400">{children}</p>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={thCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
      {!hasRows && <Empty>{empty ?? "Nothing here yet."}</Empty>}
    </div>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-blue-700 hover:underline">
      {children}
    </Link>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
    ok: "border-green-200 bg-green-50 text-green-800",
  }[tone];
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/** Thumbnails/links for attachments. */
export function Attachments({ items }: { items: { id: string; fileName: string; mimeType: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) =>
        a.mimeType.startsWith("image/") ? (
          <a key={a.id} href={`/files/${a.id}`} target="_blank" rel="noreferrer" title={a.fileName}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/files/${a.id}`} alt={a.fileName} className="h-16 w-16 rounded border border-gray-200 object-cover" />
          </a>
        ) : (
          <a key={a.id} href={`/files/${a.id}`} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-2 py-1 text-xs text-blue-700 hover:underline">
            📄 {a.fileName}
          </a>
        ),
      )}
    </div>
  );
}

/** Options for a <select> from an enum-like object. */
export function EnumOptions({ values, labels }: { values: readonly string[]; labels?: Record<string, string> }) {
  return (
    <>
      {values.map((v) => (
        <option key={v} value={v}>
          {labels?.[v] ?? humanize(v)}
        </option>
      ))}
    </>
  );
}
