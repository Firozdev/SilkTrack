"use client";

import { useEffect, useState } from "react";

/** Checkboxes that belong to the bulk form `formId` (they sit in table rows, outside the form). */
function boxes(formId: string): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="id"][form="${formId}"]`)];
}

/** How many rows there are and how many are ticked, kept up to date (also when rows come and go). */
export function useChecked(formId: string): { n: number; total: number } {
  const [state, setState] = useState({ n: 0, total: 0 });
  useEffect(() => {
    const update = () => {
      const all = boxes(formId);
      const n = all.filter((b) => b.checked).length;
      setState((s) => (s.n === n && s.total === all.length ? s : { n, total: all.length }));
    };
    update();
    document.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [formId]);
  return state;
}

/** Header checkbox: tick / untick every row on the page. */
export function SelectAll({ formId }: { formId: string }) {
  const { n, total } = useChecked(formId);
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={n > 0 && n === total}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < total;
      }}
      onChange={(e) => {
        for (const b of boxes(formId)) b.checked = e.target.checked;
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

/** Row checkbox. */
export function SelectRow({ formId, id }: { formId: string; id: string }) {
  return <input type="checkbox" name="id" value={id} form={formId} aria-label="Select" />;
}

/**
 * "Delete selected (n)" bar above a list (Admin). Opens the bulk confirmation
 * page, which lists everything that goes to Trash.
 */
export function BulkDeleteBar({ formId, type, back }: { formId: string; type: string; back: string }) {
  const { n } = useChecked(formId);
  return (
    <form id={formId} action="/settings/trash/delete" method="get" className={n ? "mb-3 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm" : "hidden"}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="back" value={back} />
      <span className="text-red-900">{n} selected</span>
      <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
        🗑 Delete selected ({n})
      </button>
      <button
        type="button"
        className="text-sm text-gray-600 hover:underline"
        onClick={() => {
          for (const b of boxes(formId)) b.checked = false;
          document.dispatchEvent(new Event("change"));
        }}
      >
        Clear
      </button>
    </form>
  );
}
