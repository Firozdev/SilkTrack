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

export function SampleInvoiceForm({
  id,
  init,
  size: sizeInit,
}: {
  id: string;
  init: {
    productRmb: string;
    chinaShippingRmb: string;
    shippingToBdRmb: string;
    serviceRmb: string;
    paymentRequired: boolean | null;
    shippingRatePerKgRmb: string;
    shippingRatePerCbmRmb: string;
  };
  size: SizeInit;
}) {
  const [size, setSize] = useState(sizeInit);
  const [rateKg, setRateKg] = useState(init.shippingRatePerKgRmb);
  const [rateCbm, setRateCbm] = useState(init.shippingRatePerCbmRmb);
  const calc = (sz: SizeInit, kg: string, cbmRate: string) => {
    const cartons = sz.cartonCount ? n(sz.cartonCount) : 1;
    const cbm = ((n(sz.lengthCm) * n(sz.widthCm) * n(sz.heightCm)) / 1_000_000) * cartons;
    return kg ? n(sz.weightKg) * n(kg) : cbmRate ? cbm * n(cbmRate) : null;
  };
  const auto = calc(size, rateKg, rateCbm);
  // A saved amount that differs from size × rate was typed by hand: keep it as an override.
  const initAuto = calc(sizeInit, init.shippingRatePerKgRmb, init.shippingRatePerCbmRmb);
  const [override, setOverride] = useState(initAuto !== null && Math.abs(initAuto - n(init.shippingToBdRmb)) < 0.005 ? "" : init.shippingToBdRmb);

  return (
    <ActionForm action={invoiceAction} submitLabel="Save invoice">
      <input type="hidden" name="id" value={id} />
      <SizeFields v={size} set={setSize} />
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
        <Field label="Rate ¥ per kg" hint="fills shipping to BD">
          <input name="shippingRatePerKgRmb" value={rateKg} onChange={(e) => (setRateKg(e.target.value), setRateCbm(""))} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="or rate ¥ per CBM">
          <input name="shippingRatePerCbmRmb" value={rateCbm} onChange={(e) => (setRateCbm(e.target.value), setRateKg(""))} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="Shipping to BD ¥" hint={auto !== null ? (override ? `typed amount (size × rate = ¥${auto.toFixed(2)}) – clear to use the rate` : `= ¥${auto.toFixed(2)} from size × rate`) : "or type it"}>
          <input name="shippingToBdRmb" value={override} placeholder={auto !== null ? auto.toFixed(2) : ""} onChange={(e) => setOverride(e.target.value)} inputMode="decimal" className={inputCls} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-xs font-medium text-gray-600">Before buying the sample</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentRequired" value="yes" defaultChecked={init.paymentRequired !== false} /> Wait for customer payment
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="paymentRequired" value="no" defaultChecked={init.paymentRequired === false} /> Buy without payment
        </label>
      </fieldset>
    </ActionForm>
  );
}

const MODES = [
  ["WEEKLY_SHIPMENT", "Planned shipment"],
  ["EXPRESS_COURIER", "Express courier (DHL, FedEx, SF…)"],
  ["HAND_CARRY", "Hand carry"],
  ["POST", "Post / EMS"],
  ["OTHER", "Other"],
] as const;

export function SampleShipForm({
  id,
  init,
  size: sizeInit,
  shipments,
}: {
  id: string;
  init: { shippingMode: string | null; shipmentId: string | null; carrierName: string; trackingNo: string; trackingUrl: string; etaBd: string };
  size: SizeInit;
  shipments: { id: string; label: string }[];
}) {
  const [mode, setMode] = useState(init.shippingMode ?? "EXPRESS_COURIER");
  const [size, setSize] = useState(sizeInit);
  const planned = mode === "WEEKLY_SHIPMENT";
  return (
    <ActionForm action={shipAction} submitLabel="Save shipping">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Shipping option">
          <select name="shippingMode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
            {MODES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {planned ? (
          <Field label="Planned shipment *" hint={shipments.length ? undefined : "No planned shipment is open – plan one on the Shipments page."}>
            <select name="shipmentId" defaultValue={init.shipmentId ?? ""} required className={inputCls}>
              <option value="">Choose…</option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Carrier / person">
              <input name="carrierName" defaultValue={init.carrierName} placeholder="DHL / Mr. Li (flight)…" className={inputCls} />
            </Field>
            <Field label={mode === "EXPRESS_COURIER" ? "Tracking no. *" : "Tracking no."}>
              <input name="trackingNo" defaultValue={init.trackingNo} required={mode === "EXPRESS_COURIER"} className={inputCls} />
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
