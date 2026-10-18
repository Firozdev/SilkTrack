"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { invoiceAction, shipAction } from "../actions";

export type SizeInit = { weightKg: string; cartonCount: string; lengthCm: string; widthCm: string; heightCm: string };
const n = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? 0 : Number(v));

/** Weight, cartons and L×W×H with live CBM. */
function SizeFields({ v, set }: { v: SizeInit; set: (v: SizeInit) => void }) {
  const cartons = v.cartonCount ? n(v.cartonCount) : 1;
  const cbm = ((n(v.lengthCm) * n(v.widthCm) * n(v.heightCm)) / 1_000_000) * cartons;
  const f = (k: keyof SizeInit) => ({ name: k, value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, [k]: e.target.value }), inputMode: "decimal" as const, className: inputCls });
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Weight kg">
          <input {...f("weightKg")} />
        </Field>
        <Field label="Cartons">
          <input {...f("cartonCount")} inputMode="numeric" />
        </Field>
        <Field label="L cm">
          <input {...f("lengthCm")} />
        </Field>
        <Field label="W cm">
          <input {...f("widthCm")} />
        </Field>
        <Field label="H cm">
          <input {...f("heightCm")} />
        </Field>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        CBM: <b>{cbm.toFixed(4)} m³</b>
      </p>
    </div>
  );
}

/**
 * Sample invoice (China, CS or Admin): prices in ¥, a free shipping charge to
 * Bangladesh in ¥, and how it will be sent.
 */
export function SampleInvoiceForm({
  id,
  init,
}: {
  id: string;
  init: { productRmb: string; chinaShippingRmb: string; shippingToBdRmb: string; serviceRmb: string; paymentRequired: boolean | null; shipWay: Way | null };
}) {
  return (
    <ActionForm action={invoiceAction} submitLabel="Save invoice">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Sample price ¥ *">
          <input name="productRmb" required defaultValue={init.productRmb} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="China shipping ¥">
          <input name="chinaShippingRmb" defaultValue={init.chinaShippingRmb} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="Service ¥">
          <input name="serviceRmb" defaultValue={init.serviceRmb} inputMode="decimal" className={inputCls} />
        </Field>
        <div />
        <Field label="Ship by *">
          <select name="shipWay" required defaultValue={init.shipWay ?? ""} className={inputCls}>
            <option value="" disabled>
              Choose…
            </option>
            {WAYS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shipping charge to BD ¥" hint="Any amount – the customer can pay it with the product or later">
          <input name="shippingToBdRmb" defaultValue={init.shippingToBdRmb} inputMode="decimal" className={inputCls} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-xs font-medium text-gray-600">Before buying the sample</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentRequired" value="yes" defaultChecked={init.paymentRequired !== false} /> Wait for customer payment (product)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentRequired" value="no" defaultChecked={init.paymentRequired === false} /> Buy without payment
        </label>
      </fieldset>
    </ActionForm>
  );
}

const WAYS = [
  ["HAND_CARRY", "Hand carry"],
  ["AIR", "Air shipment"],
  ["SEA", "Sea shipment"],
] as const;
type Way = (typeof WAYS)[number][0];

/** China sends the sample by hand carry, or in an open / upcoming air or sea weekly shipment. */
export function SampleShipForm({
  id,
  init,
  size: sizeInit,
  shipments,
}: {
  id: string;
  init: { way: Way | null; shipmentId: string | null; carrierName: string; trackingNo: string; trackingUrl: string; etaBd: string };
  size: SizeInit;
  shipments: { id: string; label: string; method: "AIR" | "SEA" }[];
}) {
  const [way, setWay] = useState<Way>(init.way ?? "HAND_CARRY");
  const [size, setSize] = useState(sizeInit);
  const planned = way !== "HAND_CARRY";
  const options = shipments.filter((s) => s.method === way);
  return (
    <ActionForm action={shipAction} submitLabel="Save shipping">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Ship by">
          <select name="way" value={way} onChange={(e) => setWay(e.target.value as Way)} className={inputCls}>
            {WAYS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {planned ? (
          <Field label={`${way === "AIR" ? "Air" : "Sea"} shipment *`} hint={options.length ? "Only open / upcoming shipments" : `No ${way.toLowerCase()} shipment is open – plan one on the Shipments page.`}>
            <select key={way} name="shipmentId" defaultValue={options.some((o) => o.id === init.shipmentId) ? (init.shipmentId ?? "") : ""} required className={inputCls}>
              <option value="">Choose…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Carried by">
              <input name="carrierName" defaultValue={init.carrierName} placeholder="Mr. Li (flight CZ392)…" className={inputCls} />
            </Field>
            <Field label="Tracking / flight no.">
              <input name="trackingNo" defaultValue={init.trackingNo} className={inputCls} />
            </Field>
            <Field label="Tracking URL">
              <input name="trackingUrl" type="url" defaultValue={init.trackingUrl} className={inputCls} />
            </Field>
          </>
        )}
        <Field label="ETA Bangladesh" hint={planned ? "Blank = the shipment's ETA" : undefined}>
          <input name="etaBd" type="date" defaultValue={init.etaBd} className={inputCls} />
        </Field>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">Parcel size{planned ? " (added to the shipment's weight and CBM)" : ""}</p>
        <SizeFields v={size} set={setSize} />
      </div>
    </ActionForm>
  );
}
