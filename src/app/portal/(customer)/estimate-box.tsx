import { estimateShipping, type RateCard } from "@/lib/shipping-estimate";
import { fill, type Dict } from "../i18n";

/** ৳1,234.50 – same output as fmtBdt, without the Decimal runtime (this also renders in the browser). */
const fmtBdt = (v: number | string) => `৳${(typeof v === "number" ? v : parseFloat(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Estimated shipping cost from the Admin rate card (works in server and client components). */
export function EstimateBox({ t, rates, method, weightKg, cbm, qa, measured }: { t: Dict; rates: RateCard; method: "AIR" | "SEA"; weightKg?: string | number | null; cbm?: string | number | null; qa: boolean; measured?: boolean }) {
  const e = estimateShipping({ method, weightKg, cbm, qa }, rates);
  const unit = method === "AIR" ? `kg` : `CBM`;
  if (!(method === "AIR" ? Number(rates.airPerKgBdt) : Number(rates.seaPerCbmBdt))) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
      <div className="mb-1 font-medium text-emerald-900">{t.estTitle}</div>
      {e ? (
        <>
          <dl className="space-y-0.5">
            <div className="flex justify-between gap-4">
              <dt>{fill(t.estShipping, { qty: `${e.qty} ${unit}`, rate: fmtBdt(e.rate) })}</dt>
              <dd>{fmtBdt(e.shipping)}</dd>
            </div>
            {e.qa > 0 && (
              <div className="flex justify-between gap-4">
                <dt>{t.qualityCheck}</dt>
                <dd>{fmtBdt(e.qa)}</dd>
              </div>
            )}
            {e.delivery > 0 && (
              <div className="flex justify-between gap-4">
                <dt>{t.homeDelivery}</dt>
                <dd>{fmtBdt(e.delivery)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-emerald-200 pt-1 font-semibold">
              <dt>{t.estTotal}</dt>
              <dd>≈ {fmtBdt(e.total)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-gray-600">{measured ? t.estNoteMeasured : t.estNoteDeclared}</p>
        </>
      ) : (
        <p className="text-xs text-gray-600">{t.estNeedSize}</p>
      )}
    </div>
  );
}

/** "Current shipping rates: Air ৳750/kg · Sea ৳28,000/CBM" – null when none set. */
export function ratesLine(t: Dict, r: RateCard, labels: { air: string; sea: string }) {
  const parts = [Number(r.airPerKgBdt) > 0 ? `${labels.air} ${fmtBdt(r.airPerKgBdt)}${t.perKg}` : "", Number(r.seaPerCbmBdt) > 0 ? `${labels.sea} ${fmtBdt(r.seaPerCbmBdt)}${t.perCbm}` : ""].filter(Boolean);
  return parts.length ? fill(t.ratesInfo, { rates: parts.join(" · ") }) : null;
}
