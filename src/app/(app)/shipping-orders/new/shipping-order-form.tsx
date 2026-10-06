"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { CustomerFields, type CustomerValue } from "../../requests/new/customer-fields";
import { createShippingOrderAction } from "../actions";

export function ShippingOrderForm({ customer }: { customer?: CustomerValue }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <ActionForm action={createShippingOrderAction} submitLabel="Create shipping order" className="max-w-5xl">
      <Card title="Customer">
        <CustomerFields initial={customer} />
      </Card>
      <Card title="Products and supplier tracking">
        <p className="mb-3 text-xs text-gray-500">One row per product or parcel. The supplier&apos;s tracking number lets the China team match it on arrival; it can be added later.</p>
        <div className="space-y-3">
          {keys.map((k, i) => (
            <div key={k} className="grid items-end gap-2 border-b border-gray-50 pb-3 sm:grid-cols-12">
              <Field label={`Product ${i + 1} *`} className="sm:col-span-3">
                <input name={`p.${k}.productName`} required className={inputCls} />
              </Field>
              <Field label="Description / variant" className="sm:col-span-3">
                <input name={`p.${k}.description`} className={inputCls} />
              </Field>
              <Field label="Qty *">
                <input name={`p.${k}.quantity`} type="number" min={1} defaultValue={1} required className={inputCls} />
              </Field>
              <Field label="Courier (China)" className="sm:col-span-2">
                <input name={`p.${k}.courierName`} placeholder="SF, ZTO, YTO…" className={inputCls} />
              </Field>
              <Field label="Tracking no." className="sm:col-span-2">
                <input name={`p.${k}.trackingNo`} className={inputCls} />
              </Field>
              {keys.length > 1 && (
                <button type="button" className={btnCls} onClick={() => setKeys(keys.filter((x) => x !== k))}>
                  Remove
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
            + Add product
          </button>
        </div>
      </Card>
      <Card title="Shipping">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Ship by">
            <select name="shippingMethod" className={inputCls}>
              <option value="AIR">Air</option>
              <option value="SEA">Sea</option>
            </select>
          </Field>
          <Field label="Estimated weight (kg)" hint="From the customer">
            <input name="declaredWeightKg" inputMode="decimal" className={inputCls} />
          </Field>
          <Field label="Estimated CBM" hint="From the customer">
            <input name="declaredCbm" inputMode="decimal" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 self-center pt-4 text-sm">
            <input type="checkbox" name="qaRequested" className="h-4 w-4" /> QA test at the China warehouse
          </label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Customer notes / what to check">
            <textarea name="customerNotes" rows={2} className={inputCls} />
          </Field>
          <Field label="Photos / supplier invoice">
            <input type="file" name="photos" accept="image/*,application/pdf" multiple className="text-sm" />
          </Field>
        </div>
      </Card>
    </ActionForm>
  );
}
