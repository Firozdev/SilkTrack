"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

export type PayChoice = { key: string; label: string; amount: string };

/**
 * Amount field for "I have paid". With choices (e.g. a sample: product only /
 * product + shipping) the customer picks one and the amount fills in; it can
 * still be changed. The server never accepts more than is due.
 */
export function PayAmount({ label, legend, choices, initial }: { label: string; legend?: string; choices?: PayChoice[]; initial: string }) {
  const [amount, setAmount] = useState(choices?.[0]?.amount ?? initial);
  const [picked, setPicked] = useState(choices?.[0]?.key);
  return (
    <>
      {choices && choices.length > 0 && (
        <fieldset className="text-sm sm:col-span-2">
          {legend && <legend className="mb-1 text-xs font-medium text-gray-600">{legend}</legend>}
          <div className="flex flex-wrap gap-4">
            {choices.map((c) => (
              <label key={c.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="payFor"
                  value={c.key}
                  checked={picked === c.key}
                  onChange={() => {
                    setPicked(c.key);
                    setAmount(c.amount);
                  }}
                />
                {c.label} <b className="tabular-nums">৳{c.amount}</b>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label={label}>
        <input name="amountBdt" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
      </Field>
    </>
  );
}
