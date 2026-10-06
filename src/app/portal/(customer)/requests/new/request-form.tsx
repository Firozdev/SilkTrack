"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { portalRequestAction } from "../../../actions";
import type { Dict } from "../../../i18n";

export function PortalRequestForm({ t }: { t: Dict }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <ActionForm action={portalRequestAction} submitLabel={t.sendRequest} className="max-w-4xl">
      <Card title={t.products}>
        <div className="space-y-4">
          {keys.map((k, i) => (
            <div key={k} className="space-y-2 border-b border-gray-100 pb-4">
              <div className="grid gap-2 sm:grid-cols-6">
                <Field label={`${t.productN} ${i + 1} *`} className="sm:col-span-3">
                  <input name={`lines.${k}.productName`} required className={inputCls} />
                </Field>
                <Field label={t.colour}>
                  <input name={`lines.${k}.color`} className={inputCls} />
                </Field>
                <Field label={t.sizeModel}>
                  <input name={`lines.${k}.size`} className={inputCls} />
                </Field>
                <Field label={t.qty}>
                  <input name={`lines.${k}.quantity`} type="number" min={1} defaultValue={1} required className={inputCls} />
                </Field>
              </div>
              <Field label={t.links} hint={t.linksHint}>
                <textarea name={`lines.${k}.links`} rows={2} placeholder="https://detail.1688.com/offer/…" className={inputCls} />
              </Field>
              <div className="grid items-end gap-2 sm:grid-cols-2">
                <Field label={t.notes}>
                  <input name={`lines.${k}.notes`} className={inputCls} />
                </Field>
                <Field label={t.lineFiles}>
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
            <select name="shippingMethod" className={inputCls}>
              <option value="AIR">{t.airFaster}</option>
              <option value="SEA">{t.seaCheaper}</option>
            </select>
          </Field>
          <Field label={t.budget}>
            <input name="targetBudgetBdt" inputMode="decimal" className={inputCls} />
          </Field>
          <Field label={t.anythingElse}>
            <input name="customerNotes" className={inputCls} />
          </Field>
        </div>
      </Card>
    </ActionForm>
  );
}
