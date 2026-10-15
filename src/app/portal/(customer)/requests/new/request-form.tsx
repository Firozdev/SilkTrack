"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { portalRequestAction } from "../../../actions";
import type { Dict } from "../../../i18n";
import { CustomerPicker, type PickCustomer } from "../../customer-picker";

export type RequestLineInit = { id: string; productName: string; color: string; size: string; quantity: number; notes: string; links: string; files: number };
export type RequestInit = { id: string; shippingMethod: "AIR" | "SEA"; qaRequested: boolean; targetBudgetBdt: string; customerNotes: string; lines: RequestLineInit[] };

/** New request, or editing one (`initial` + `action`). Agents pass `customers` to choose who it is for. */
export function PortalRequestForm({
  t,
  initial,
  action = portalRequestAction,
  submitLabel,
  customers,
}: {
  t: Dict;
  initial?: RequestInit;
  action?: (p: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel?: string;
  customers?: PickCustomer[];
}) {
  const start = initial?.lines.length ? initial.lines.map((_, i) => i) : [0];
  const [keys, setKeys] = useState(start);
  const [next, setNext] = useState(start.length);
  const init = (k: number) => initial?.lines[k];
  return (
    <ActionForm action={action} submitLabel={submitLabel ?? t.sendRequest} className="max-w-4xl">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {customers && <CustomerPicker t={t} customers={customers} />}
      <Card title={t.products}>
        <div className="space-y-4">
          {keys.map((k, i) => (
            <div key={k} className="space-y-2 border-b border-gray-100 pb-4">
              {init(k) && <input type="hidden" name={`lines.${k}.id`} value={init(k)!.id} />}
              <div className="grid gap-2 sm:grid-cols-6">
                <Field label={`${t.productN} ${i + 1} *`} className="sm:col-span-3">
                  <input name={`lines.${k}.productName`} required defaultValue={init(k)?.productName} className={inputCls} />
                </Field>
                <Field label={t.colour}>
                  <input name={`lines.${k}.color`} defaultValue={init(k)?.color} className={inputCls} />
                </Field>
                <Field label={t.sizeModel}>
                  <input name={`lines.${k}.size`} defaultValue={init(k)?.size} className={inputCls} />
                </Field>
                <Field label={t.qty}>
                  <input name={`lines.${k}.quantity`} type="number" min={1} defaultValue={init(k)?.quantity ?? 1} required className={inputCls} />
                </Field>
              </div>
              <Field label={t.links} hint={t.linksHint}>
                <textarea name={`lines.${k}.links`} rows={2} placeholder="https://detail.1688.com/offer/…" defaultValue={init(k)?.links} className={inputCls} />
              </Field>
              <div className="grid items-end gap-2 sm:grid-cols-2">
                <Field label={t.notes}>
                  <input name={`lines.${k}.notes`} defaultValue={init(k)?.notes} className={inputCls} />
                </Field>
                <Field label={t.lineFiles} hint={init(k)?.files ? t.attachedFiles.replace("{n}", String(init(k)!.files)) : undefined}>
                  <input type="file" name={`lines.${k}.images`} accept="image/*,application/pdf" multiple className="text-sm" />
                </Field>
              </div>
              {keys.length > 1 && (
                <button type="button" className={btnCls} onClick={() => setKeys(keys.filter((x) => x !== k))}>
                  {t.remove}
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              setKeys([...keys, next]);
              setNext(next + 1);
            }}
          >
            {t.addProduct}
          </button>
        </div>
      </Card>
      <Card title={t.shipping}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t.colShipBy}>
            <select name="shippingMethod" defaultValue={initial?.shippingMethod ?? "AIR"} className={inputCls}>
              <option value="AIR">{t.airFaster}</option>
              <option value="SEA">{t.seaCheaper}</option>
            </select>
          </Field>
          <Field label={t.budget}>
            <input name="targetBudgetBdt" inputMode="decimal" defaultValue={initial?.targetBudgetBdt} className={inputCls} />
          </Field>
          <Field label={t.anythingElse}>
            <input name="customerNotes" defaultValue={initial?.customerNotes} className={inputCls} />
          </Field>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" name="qaRequested" defaultChecked={initial?.qaRequested ?? false} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="font-medium">{t.qaRequired}</span>
            <span className="block text-xs text-gray-500">{t.qaRequiredHint}</span>
          </span>
        </label>
      </Card>
    </ActionForm>
  );
}
