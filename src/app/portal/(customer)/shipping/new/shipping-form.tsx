"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { portalShippingAction } from "../../../actions";
import type { Dict } from "../../../i18n";
import type { RateCard } from "@/lib/shipping-estimate";
import { EstimateBox } from "../../estimate-box";
import { CustomerPicker, type PickCustomer } from "../../customer-picker";

export type ShippingItemInit = { id: string; productName: string; description: string; quantity: number; courierName: string; trackingNo: string; files: number };
export type ShippingInit = { id: string; shippingMethod: "AIR" | "SEA"; qaRequested: boolean; declaredWeightKg: string; declaredCbm: string; customerNotes: string; items: ShippingItemInit[] };

/** New shipping order, or editing one (`initial` + `action`). */
export function PortalShippingForm({
  t,
  rates,
  initial,
  action = portalShippingAction,
  submitLabel,
  customers,
}: {
  t: Dict;
  rates: RateCard;
  initial?: ShippingInit;
  action?: (p: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel?: string;
  /** Agents: their customers, to choose who it is for. */
  customers?: PickCustomer[];
}) {
  const [method, setMethod] = useState<"AIR" | "SEA">(initial?.shippingMethod ?? "AIR");
  const [weight, setWeight] = useState(initial?.declaredWeightKg ?? "");
  const [cbm, setCbm] = useState(initial?.declaredCbm ?? "");
  const [qa, setQa] = useState(initial?.qaRequested ?? false);
  const start = initial?.items.length ? initial.items.map((_, i) => i) : [0];
  const [keys, setKeys] = useState(start);
  const [next, setNext] = useState(start.length);
  const init = (k: number) => initial?.items[k];
  return (
    <ActionForm action={action} submitLabel={submitLabel ?? t.sendShipping} className="max-w-4xl">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {customers && <CustomerPicker t={t} customers={customers} />}
      <Card title={t.productsTracking}>
        <p className="mb-3 text-xs text-gray-500">{t.trackingLater}</p>
        <div className="space-y-3">
          {keys.map((k, i) => (
            <div key={k} className="grid items-end gap-2 border-b border-gray-50 pb-3 sm:grid-cols-12">
              {init(k) && <input type="hidden" name={`p.${k}.id`} value={init(k)!.id} />}
              <Field label={`${t.productN} ${i + 1} *`} className="sm:col-span-3">
                <input name={`p.${k}.productName`} required defaultValue={init(k)?.productName} className={inputCls} />
              </Field>
              <Field label={t.description} className="sm:col-span-3">
                <input name={`p.${k}.description`} defaultValue={init(k)?.description} className={inputCls} />
              </Field>
              <Field label={t.qty}>
                <input name={`p.${k}.quantity`} type="number" min={1} defaultValue={init(k)?.quantity ?? 1} required className={inputCls} />
              </Field>
              <Field label={t.chinaCourier} className="sm:col-span-2">
                <input name={`p.${k}.courierName`} placeholder="SF, ZTO, YTO…" defaultValue={init(k)?.courierName} className={inputCls} />
              </Field>
              <Field label={t.trackingNo} className="sm:col-span-2">
                <input name={`p.${k}.trackingNo`} defaultValue={init(k)?.trackingNo} className={inputCls} />
              </Field>
              <Field label={t.lineFiles} hint={init(k)?.files ? t.attachedFiles.replace("{n}", String(init(k)!.files)) : undefined} className="sm:col-span-4">
                <input type="file" name={`p.${k}.files`} accept="image/*,application/pdf" multiple className="text-sm" />
              </Field>
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
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t.colShipBy}>
            <select name="shippingMethod" value={method} onChange={(e) => setMethod(e.target.value as "AIR" | "SEA")} className={inputCls}>
              <option value="AIR">{t.air}</option>
              <option value="SEA">{t.sea}</option>
            </select>
          </Field>
          <Field label={t.estWeight}>
            <input name="declaredWeightKg" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t.estCbm}>
            <input name="declaredCbm" inputMode="decimal" value={cbm} onChange={(e) => setCbm(e.target.value)} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 self-center pt-4 text-sm">
            <input type="checkbox" name="qaRequested" checked={qa} onChange={(e) => setQa(e.target.checked)} className="h-4 w-4" /> {t.qaCheck}
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t.notesCheck}>
            <textarea name="customerNotes" rows={2} defaultValue={initial?.customerNotes} className={inputCls} />
          </Field>
          <Field label={t.filesHint}>
            <input type="file" name="photos" accept="image/*,application/pdf" multiple className="text-sm" />
          </Field>
        </div>
        <div className="mt-3">
          <EstimateBox t={t} rates={rates} method={method} weightKg={weight} cbm={cbm} qa={qa} />
        </div>
      </Card>
    </ActionForm>
  );
}
