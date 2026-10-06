import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { btnCls, inputCls } from "@/components/ui";
import { portalCancelAction } from "../actions";
import type { Dict } from "../i18n";

/** Edit / cancel controls shown while the customer may still change the order. */
export function EditBar({ t, kind, id, editHref }: { t: Dict; kind: "order" | "shipping"; id: string; editHref: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
      <div>
        <p className="mb-2 text-sm text-gray-600">{t.editHint}</p>
        <Link href={editHref} className={btnCls}>
          ✏ {t.edit}
        </Link>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-red-700">{t.cancelOrder}…</summary>
        <ActionForm action={portalCancelAction} submitLabel={t.cancelOrder} variant="danger" confirm={t.cancelConfirm} className="mt-2">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input name="reason" placeholder={t.cancelReason} className={inputCls} />
        </ActionForm>
      </details>
    </div>
  );
}
