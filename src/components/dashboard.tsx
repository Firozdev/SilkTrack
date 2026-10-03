import Link from "next/link";
import type { ReactNode } from "react";
import { humanize } from "@/lib/format";

/** KPI tile: one number, a caption, optional link to the list behind it. */
export function StatTile({ label, value, hint, href, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "default" | "attention" | "danger" }) {
  const ring = tone === "danger" ? "border-red-300" : tone === "attention" ? "border-amber-300" : "border-gray-200";
  const body = (
    <div className={`h-full rounded-lg border bg-white p-3 ${ring} ${href ? "transition hover:border-blue-400 hover:shadow-sm" : ""}`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

/**
 * Value against a limit. Fill shifts accent → warning → danger; the track is
 * a lighter step of the same hue. Text always states the numbers.
 */
export function Meter({ label, value, max, unit }: { label: string; value: number; max: number | null; unit: string }) {
  const pct = max ? (value / max) * 100 : null;
  const fill = pct === null ? "bg-blue-600" : pct > 100 ? "bg-red-600" : pct >= 90 ? "bg-amber-500" : "bg-blue-600";
  const track = pct === null ? "bg-blue-100" : pct > 100 ? "bg-red-100" : pct >= 90 ? "bg-amber-100" : "bg-blue-100";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">
          {value.toLocaleString("en-US", { maximumFractionDigits: 3 })} {unit}
          {max ? ` / ${max.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unit}` : " · no limit set"}
          {pct !== null && pct > 100 && " ⚠ over"}
        </span>
      </div>
      <div
        className={`mt-1 h-2 rounded-full ${track}`}
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max ?? undefined}
      >
        {pct !== null && <div className={`h-2 rounded-full ${fill}`} style={{ width: `${Math.min(100, pct)}%` }} />}
      </div>
    </div>
  );
}

/** Horizontal bars, one hue, counts per order status (links to the filtered list). */
export function StatusBars({ rows }: { rows: { status: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (total === 0) return <p className="text-sm text-gray-400">No active orders yet.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.status} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2 text-sm" title={`${humanize(r.status)}: ${r.count}`}>
          <span className="truncate text-gray-600">{humanize(r.status)}</span>
          <span className="h-3 rounded-r bg-gray-50">
            {r.count > 0 && <span className="block h-3 rounded-r bg-[#2a78d6]" style={{ width: `${(r.count / max) * 100}%`, minWidth: "4px" }} />}
          </span>
          <span className="text-right tabular-nums text-gray-900">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}
