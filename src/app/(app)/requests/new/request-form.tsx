"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { createRequestAction } from "../actions";
import { CustomerFields, type CustomerValue } from "./customer-fields";

export function RequestForm({ bulkQty, customer }: { bulkQty: number; customer?: CustomerValue }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);

  return (
    <ActionForm action={createRequestAction} submitLabel="Create request" className="max-w-4xl">
      <Card title="Customer">
        <CustomerFields initial={customer} />
      </Card>

      <Card title="Order">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Shipping method">
            <select name="shippingMethod" className={inputCls}>
              <option value="AIR">Air</option>
              <option value="SEA">Sea</option>
            </select>
          </Field>
          <Field label="Request type" hint={`Auto: Bulk from ${bulkQty} pcs or the budget threshold`}>
            <select name="type" className={inputCls} defaultValue="AUTO">
              <option value="AUTO">Auto-suggest</option>
              <option value="SINGLE">Single</option>
              <option value="BULK">Bulk</option>
            </select>
          </Field>
          <Field label="Target budget (BDT)">
            <input name="targetBudgetBdt" inputMode="decimal" className={inputCls} />
          </Field>
          <Field label="Priority" hint="Higher = sooner">
            <input name="priority" type="number" min={0} defaultValue={0} className={inputCls} />
          </Field>
          <Field label="Customer notes" className="sm:col-span-2">
            <textarea name="customerNotes" rows={2} className={inputCls} />
          </Field>
          <Field label="Special instructions" className="sm:col-span-2">
            <textarea name="specialInstructions" rows={2} className={inputCls} />
          </Field>
        </div>
      </Card>

      {keys.map((k, idx) => (
        <Card
          key={k}
          title={`Product ${idx + 1}`}
          actions={
            keys.length > 1 && (
              <button type="button" className={btnCls} onClick={() => setKeys(keys.filter((x) => x !== k))}>
                Remove
              </button>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Product name *" className="sm:col-span-3">
              <input name={`lines.${k}.productName`} required className={inputCls} />
            </Field>
            <Field label="Quantity *">
              <input name={`lines.${k}.quantity`} type="number" min={1} defaultValue={1} required className={inputCls} />
            </Field>
            <Field label="Color">
              <input name={`lines.${k}.color`} className={inputCls} />
            </Field>
            <Field label="Size">
              <input name={`lines.${k}.size`} className={inputCls} />
            </Field>
            <Field label="Model">
              <input name={`lines.${k}.model`} className={inputCls} />
            </Field>
            <Field label="Product link(s)" hint="1688, Taobao, Alibaba, Tmall… one per line" className="sm:col-span-5">
              <textarea name={`lines.${k}.links`} rows={2} className={inputCls} />
            </Field>
            <Field label="Notes" className="sm:col-span-3">
              <input name={`lines.${k}.notes`} className={inputCls} />
            </Field>
            <Field label="Images" className="sm:col-span-3">
              <input name={`lines.${k}.images`} type="file" accept="image/*" multiple className="text-sm" />
            </Field>
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={btnCls}
          onClick={() => {
            setKeys([...keys, next]);
            setNext(next + 1);
          }}
        >
          + Add another product
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowDuplicates" /> Create anyway if a link was already requested
        </label>
      </div>
    </ActionForm>
  );
}
