"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { CustomerFields, type CustomerValue } from "../../requests/new/customer-fields";
import { createStandaloneAction } from "../actions";

export function SampleForm({ customer }: { customer?: CustomerValue }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <ActionForm action={createStandaloneAction} submitLabel="Create sample" className="max-w-4xl">
      <Card title="Customer">
        <CustomerFields initial={customer} />
      </Card>
      <Card title="Products to sample">
        <div className="space-y-3">
          {keys.map((k, i) => (
            <div key={k} className="grid items-end gap-2 sm:grid-cols-12">
              <Field label={`Product ${i + 1} *`} className="sm:col-span-4">
                <input name={`p.${k}.productName`} required className={inputCls} />
              </Field>
              <Field label="Colour / size / model" className="sm:col-span-3">
                <input name={`p.${k}.variant`} className={inputCls} />
              </Field>
              <Field label="Link (1688, Taobao…)" className="sm:col-span-3">
                <input name={`p.${k}.link`} type="url" placeholder="https://" className={inputCls} />
              </Field>
              <Field label="Qty *">
                <input name={`p.${k}.quantity`} type="number" min={1} defaultValue={1} required className={inputCls} />
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Note for China (what to check)">
            <textarea name="note" rows={2} className={inputCls} />
          </Field>
          <Field label="Reference photos">
            <input type="file" name="photos" accept="image/*" multiple className="text-sm" />
          </Field>
        </div>
      </Card>
    </ActionForm>
  );
}
