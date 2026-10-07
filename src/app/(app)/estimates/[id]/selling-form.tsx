"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { sellingAction } from "../actions";

type Line = { id: string; productName: string; quantity: number; costHint: string; unit: string };

const n = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
const bdt = (v: number) => `৳${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** CS enters the product price PER UNIT; the line total (unit × qty) is shown live and saved by the server. */
export function SellingForm({ estimateId, lines }: { estimateId: string; lines: Line[] }) {
  const [units, setUnits] = useState(() => Object.fromEntries(lines.map((l) => [l.id, l.unit])));
  const total = lines.reduce((a, l) => a + n(units[l.id]) * l.quantity, 0);
  return (
    <ActionForm action={sellingAction} submitLabel="Save selling prices">
      <input type="hidden" name="id" value={estimateId} />
      {lines.map((l, i) => (
        <div key={l.id} className="grid items-end gap-2 sm:grid-cols-4">
          <input type="hidden" name={`s.${i}.lineId`} value={l.id} />
          <div className="text-sm sm:col-span-2">
            {l.productName} × <b>{l.quantity}</b>
            <div className="text-xs text-gray-400">{l.costHint}</div>
          </div>
          <Field label="Price ৳ per unit">
            <input
              name={`s.${i}.unitPriceBdt`}
              value={units[l.id]}
              onChange={(e) => setUnits({ ...units, [l.id]: e.target.value })}
              required
              inputMode="decimal"
              className={inputCls}
            />
          </Field>
          <div className="pb-2 text-sm">
            <span className="text-xs text-gray-500">Line total</span> <b className="tabular-nums">{bdt(n(units[l.id]) * l.quantity)}</b>
          </div>
        </div>
      ))}
      <p className="text-right text-sm">
        Products total: <b className="tabular-nums">{bdt(total)}</b>
      </p>
    </ActionForm>
  );
}
