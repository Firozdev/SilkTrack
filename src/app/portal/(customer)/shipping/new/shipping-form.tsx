"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { portalShippingAction } from "../../../actions";
import type { Dict } from "../../../i18n";

export function PortalShippingForm({ t }: { t: Dict }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <ActionForm action={portalShippingAction} submitLabel={t.sendShipping} className="max-w-4xl">
      <Card title={t.productsTracking}>
        <p className="mb-3 text-xs text-gray-500">{t.trackingLater}</p>
        <div className="space-y-3">
          {keys.map((k, i) => (
            <div key={k} className="grid items-end gap-2 border-b border-gray-50 pb-3 sm:grid-cols-12">
              <Field label={`${t.productN} ${i + 1} *`} className="sm:col-span-3">
                <input name={`p.${k}.productName`} required className={inputCls} />
              </Field>
              <Field label={t.description} className="sm:col-span-3">
                <input name={`p.${k}.description`} className={inputCls} />
              </Field>
              <Field label={t.qty}>
                <input name={`p.${k}.quantity`} type="number" min={1} defaultValue={1} required className={inputCls} />
              </Field>
              <Field label={t.chinaCourier} className="sm:col-span-2">
                <input name={`p.${k}.courierName`} placeholder="SF, ZTO, YTO…" className={inputCls} />
              </Field>
              <Field label={t.trackingNo} className="sm:col-span-2">
                <input name={`p.${k}.trackingNo`} className={inputCls} />
              </Field>
              <Field label={t.lineFiles} className="sm:col-span-4">
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
            <select name="shippingMethod" className={inputCls}>
              <option value="AIR">{t.air}</option>
              <option value="SEA">{t.sea}</option>
            </select>
          </Field>
          <Field label={t.estWeight}>
            <input name="declaredWeightKg" inputMode="decimal" className={inputCls} />
          </Field>
          <Field label={t.estCbm}>
            <input name="declaredCbm" inputMode="decimal" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 self-center pt-4 text-sm">
            <input type="checkbox" name="qaRequested" className="h-4 w-4" /> {t.qaCheck}
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t.notesCheck}>
            <textarea name="customerNotes" rows={2} className={inputCls} />
          </Field>
          <Field label={t.filesHint}>
            <input type="file" name="photos" accept="image/*,application/pdf" multiple className="text-sm" />
          </Field>
        </div>
      </Card>
    </ActionForm>
  );
}
