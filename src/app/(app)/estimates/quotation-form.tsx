"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputCls } from "@/components/ui";
import { saveQuotationAction } from "./actions";

export type QLine = { id: string; lineNo: number; productName: string; variant: string; quantity: number; link?: string };
type LineVals = { unitPriceRmb: string; moq: string; unitWeightKg: string; cartonCount: string; lengthCm: string; widthCm: string; heightCm: string; sellingPriceBdt: string };
export type QInitial = {
  shippingMethod: "AIR" | "SEA";
  shippingRatePerKgRmb: string;
  shippingRatePerCbmRmb: string;
  domesticShippingRmb: string;
  packingRmb: string;
  inspectionRmb: string;
  serviceFeeRmb: string;
  validUntil: string;
  notes: string;
  lines: Record<string, Partial<LineVals>>;
};

const n = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? 0 : Number(v));
const fmt = (v: number, dp = 2) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** China quotation with live totals (preview only – the server recalculates with exact decimals). */
export function QuotationForm({ orderId, lines, initial, canSetSelling, rate }: { orderId: string; lines: QLine[]; initial: QInitial; canSetSelling: boolean; rate: string | null }) {
  const [h, setH] = useState(initial);
  const [vals, setVals] = useState<Record<string, LineVals>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        { unitPriceRmb: "", moq: "", unitWeightKg: "", cartonCount: "", lengthCm: "", widthCm: "", heightCm: "", sellingPriceBdt: "", ...initial.lines[l.id] },
      ]),
    ),
  );
  const setLine = (id: string, k: keyof LineVals, v: string) => setVals({ ...vals, [id]: { ...vals[id], [k]: v } });
  const setHead = (k: keyof QInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setH({ ...h, [k]: e.target.value });

  const calc = lines.map((l) => {
    const v = vals[l.id];
    const cartons = n(v.cartonCount);
    return {
      total: n(v.unitPriceRmb) * l.quantity,
      weight: n(v.unitWeightKg) * l.quantity,
      cbm: ((n(v.lengthCm) * n(v.widthCm) * n(v.heightCm)) / 1_000_000) * cartons,
      cartons,
    };
  });
  const subtotal = calc.reduce((a, c) => a + c.total, 0);
  const weight = calc.reduce((a, c) => a + c.weight, 0);
  const cbm = calc.reduce((a, c) => a + c.cbm, 0);
  const china = n(h.domesticShippingRmb) + n(h.packingRmb) + n(h.inspectionRmb) + n(h.serviceFeeRmb);
  const shipping = h.shippingMethod === "AIR" ? weight * n(h.shippingRatePerKgRmb) : cbm * n(h.shippingRatePerCbmRmb);
  const total = subtotal + china + shipping;
  const r = rate ? Number(rate) : 0;
  const selling = lines.reduce((a, l) => a + n(vals[l.id].sellingPriceBdt), 0);

  return (
    <ActionForm action={saveQuotationAction} submitLabel="Save & submit to Bangladesh" secondary={{ label: "Save draft", name: "intent", value: "draft" }} className="max-w-6xl">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="intent" value="submit" />
      <Card title="Products">
        <div className="space-y-4">
          {lines.map((l, i) => {
            const v = vals[l.id];
            const c = calc[i];
            const nm = (k: keyof LineVals) => `l.${i}.${k}`;
            return (
              <div key={l.id} className="rounded-md border border-gray-100 p-3">
                <input type="hidden" name={nm("orderLineId" as keyof LineVals)} value={l.id} />
                <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
                  <span>
                    <b>
                      {l.lineNo}. {l.productName}
                    </b>{" "}
                    <span className="text-gray-500">
                      {l.variant} · qty {l.quantity}
                    </span>
                    {l.link && (
                      <a href={l.link} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-700 hover:underline">
                        link ↗
                      </a>
                    )}
                  </span>
                  <span className="text-xs text-gray-600">
                    = <b>¥{fmt(c.total)}</b> · {fmt(c.weight, 3)} kg · {fmt(c.cbm, 4)} m³
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  <Field label="Unit price ¥ *">
                    <input name={nm("unitPriceRmb")} value={v.unitPriceRmb} onChange={(e) => setLine(l.id, "unitPriceRmb", e.target.value)} required inputMode="decimal" className={inputCls} />
                  </Field>
                  <Field label="MOQ">
                    <input name={nm("moq")} value={v.moq} onChange={(e) => setLine(l.id, "moq", e.target.value)} inputMode="numeric" className={inputCls} />
                  </Field>
                  <Field label="Unit weight kg">
                    <input name={nm("unitWeightKg")} value={v.unitWeightKg} onChange={(e) => setLine(l.id, "unitWeightKg", e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                  <Field label="Cartons">
                    <input name={nm("cartonCount")} value={v.cartonCount} onChange={(e) => setLine(l.id, "cartonCount", e.target.value)} inputMode="numeric" className={inputCls} />
                  </Field>
                  <Field label="L cm">
                    <input name={nm("lengthCm")} value={v.lengthCm} onChange={(e) => setLine(l.id, "lengthCm", e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                  <Field label="W cm">
                    <input name={nm("widthCm")} value={v.widthCm} onChange={(e) => setLine(l.id, "widthCm", e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                  <Field label="H cm">
                    <input name={nm("heightCm")} value={v.heightCm} onChange={(e) => setLine(l.id, "heightCm", e.target.value)} inputMode="decimal" className={inputCls} />
                  </Field>
                  {canSetSelling && (
                    <Field label="Selling ৳ (line)">
                      <input name={nm("sellingPriceBdt")} value={v.sellingPriceBdt} onChange={(e) => setLine(l.id, "sellingPriceBdt", e.target.value)} inputMode="decimal" className={inputCls} />
                    </Field>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="China costs & shipping (RMB)">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Domestic shipping ¥">
              <input name="domesticShippingRmb" value={h.domesticShippingRmb} onChange={setHead("domesticShippingRmb")} inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Packing ¥">
              <input name="packingRmb" value={h.packingRmb} onChange={setHead("packingRmb")} inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Inspection / QC ¥">
              <input name="inspectionRmb" value={h.inspectionRmb} onChange={setHead("inspectionRmb")} inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Service fee ¥">
              <input name="serviceFeeRmb" value={h.serviceFeeRmb} onChange={setHead("serviceFeeRmb")} inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Ship by">
              <select name="shippingMethod" value={h.shippingMethod} onChange={setHead("shippingMethod")} className={inputCls}>
                <option value="AIR">Air (by weight)</option>
                <option value="SEA">Sea (by CBM)</option>
              </select>
            </Field>
            {h.shippingMethod === "AIR" ? (
              <Field label="Air rate ¥ per kg *">
                <input name="shippingRatePerKgRmb" value={h.shippingRatePerKgRmb} onChange={setHead("shippingRatePerKgRmb")} required inputMode="decimal" className={inputCls} />
              </Field>
            ) : (
              <Field label="Sea rate ¥ per CBM *">
                <input name="shippingRatePerCbmRmb" value={h.shippingRatePerCbmRmb} onChange={setHead("shippingRatePerCbmRmb")} required inputMode="decimal" className={inputCls} />
              </Field>
            )}
            <Field label="Valid until *">
              <input type="date" name="validUntil" value={h.validUntil} onChange={setHead("validUntil")} required className={inputCls} />
            </Field>
          </div>
          <Field label="Notes for Bangladesh (stock, MOQ, alternatives…)" className="mt-2">
            <textarea name="notes" rows={2} value={h.notes} onChange={setHead("notes")} className={inputCls} />
          </Field>
        </Card>

        <Card title="Total">
          <dl className="space-y-1.5 text-sm">
            {[
              ["Products", `¥${fmt(subtotal)}`],
              ["China costs", `¥${fmt(china)}`],
              [`Total weight · CBM`, `${fmt(weight, 3)} kg · ${fmt(cbm, 4)} m³ · ${calc.reduce((a, c) => a + c.cartons, 0)} ctn`],
              [h.shippingMethod === "AIR" ? `Shipping (${fmt(weight, 3)} kg × ¥${h.shippingRatePerKgRmb || 0})` : `Shipping (${fmt(cbm, 4)} m³ × ¥${h.shippingRatePerCbmRmb || 0})`, `¥${fmt(shipping)}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right tabular-nums">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 text-base">
              <dt className="font-semibold">Total order price</dt>
              <dd className="text-right font-semibold tabular-nums">¥{fmt(total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">≈ BDT at today&apos;s rate {rate ?? "—"}</dt>
              <dd className="text-right tabular-nums">{rate ? `৳${fmt(total * r)}` : "—"}</dd>
            </div>
            {canSetSelling && selling > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Selling total</dt>
                <dd className="text-right tabular-nums">৳{fmt(selling)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-gray-400">The rate is locked when you save. Totals are recalculated exactly on the server.</p>
        </Card>
      </div>
    </ActionForm>
  );
}
