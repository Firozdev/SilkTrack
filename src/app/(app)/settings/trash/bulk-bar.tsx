"use client";

import { useActionState } from "react";
import { useChecked } from "@/components/bulk-select";
import { btnCls, btnDangerCls } from "@/components/ui";
import { trashBulkAction } from "./actions";

const FORM = "bulk-trash";

/** Trash page: restore or delete forever the ticked items. */
export function TrashBulkBar() {
  const [state, action, pending] = useActionState(trashBulkAction, {});
  const { n } = useChecked(FORM);
  return (
    <form id={FORM} action={action} className="mb-3 space-y-2">
      {n > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <span>{n} selected</span>
          <button type="submit" name="op" value="restore" disabled={pending} className={btnCls}>
            Restore selected ({n})
          </button>
          <button
            type="submit"
            name="op"
            value="forever"
            disabled={pending}
            className={btnDangerCls}
            onClick={(e) => {
              if (!window.confirm(`Delete ${n} item${n === 1 ? "" : "s"} forever? This can't be undone.`)) e.preventDefault();
            }}
          >
            Delete selected forever ({n})
          </button>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.ok && state.message && <p className="text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
