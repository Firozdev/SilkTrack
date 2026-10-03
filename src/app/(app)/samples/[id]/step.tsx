import type { ReactNode } from "react";

export type StepState = "done" | "current" | "todo" | "skipped";

/**
 * One step of the sample workflow. Done/skipped steps collapse to a one-line
 * summary (click to expand); the current step is open; future steps are greyed.
 */
export function Step({ n, title, state, summary, children }: { n: number; title: string; state: StepState; summary?: ReactNode; children?: ReactNode }) {
  const dot =
    state === "done" ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">✓</span>
    ) : state === "current" ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{n}</span>
    ) : state === "skipped" ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm font-bold text-white">–</span>
    ) : (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 text-sm font-semibold text-gray-400">{n}</span>
    );
  const head = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className={`font-medium ${state === "todo" ? "text-gray-400" : "text-gray-900"}`}>{title}</span>
      {summary && <span className={`text-sm ${state === "current" ? "text-blue-700" : "text-gray-500"}`}>{summary}</span>}
    </div>
  );

  if (state === "todo" || !children) {
    return (
      <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${state === "todo" ? "border-dashed border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}>
        {dot}
        {head}
      </div>
    );
  }
  return (
    <details open={state === "current"} className={`group rounded-lg border bg-white ${state === "current" ? "border-blue-300 shadow-sm" : "border-gray-200"}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {dot}
        {head}
        <span className="text-xs text-gray-400 transition group-open:rotate-180" aria-hidden>
          ▼
        </span>
      </summary>
      <div className="border-t border-gray-100 px-4 py-3">{children}</div>
    </details>
  );
}

/** Shown in the current step to the team that is not acting. */
export function Waiting({ who, what }: { who: string; what: string }) {
  return <p className="text-sm text-gray-500">⏳ Waiting for the {who} team to {what}.</p>;
}
