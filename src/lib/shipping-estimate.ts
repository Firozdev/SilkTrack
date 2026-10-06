/**
 * Customer-facing shipping estimate from the Admin rate card. Display only
 * (plain numbers, works in the browser too) – invoices are calculated with
 * Decimal in src/server/shipping-orders.ts.
 */
export type RateCard = { airPerKgBdt: string; seaPerCbmBdt: string; qaFeeBdt: string; localDeliveryBdt: string };

const num = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Null when the rate for that method isn't set, or there's no weight / CBM to price. */
export function estimateShipping(input: { method: "AIR" | "SEA"; weightKg?: string | number | null; cbm?: string | number | null; qa?: boolean }, rates: RateCard) {
  const air = input.method === "AIR";
  const rate = num(air ? rates.airPerKgBdt : rates.seaPerCbmBdt);
  const qty = num(air ? input.weightKg : input.cbm);
  if (!rate || !qty) return null;
  const shipping = r2(qty * rate);
  const qa = input.qa ? num(rates.qaFeeBdt) : 0;
  const delivery = num(rates.localDeliveryBdt);
  return { qty, rate, shipping, qa, delivery, total: r2(shipping + qa + delivery) };
}

export const hasRates = (r: RateCard) => num(r.airPerKgBdt) > 0 || num(r.seaPerCbmBdt) > 0;
