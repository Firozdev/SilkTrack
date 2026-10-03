import type { ShippingMethod } from "@/generated/prisma/enums";
import { D, money, rmbToBdt, sum, type Decimal, type DecimalLike } from "./money";

export type QuoteLineInput = {
  quantity: number;
  unitPriceRmb: DecimalLike;
  unitWeightKg?: DecimalLike | null;
  cartonCount?: number | null;
  lengthCm?: DecimalLike | null;
  widthCm?: DecimalLike | null;
  heightCm?: DecimalLike | null;
};

export type QuoteInput = {
  shippingMethod: ShippingMethod;
  shippingRatePerKgRmb?: DecimalLike | null;
  shippingRatePerCbmRmb?: DecimalLike | null;
  domesticShippingRmb?: DecimalLike | null;
  packingRmb?: DecimalLike | null;
  inspectionRmb?: DecimalLike | null;
  serviceFeeRmb?: DecimalLike | null;
  lines: QuoteLineInput[];
};

export type QuoteLineResult = { lineTotalRmb: Decimal; weightKg: Decimal; cbm: Decimal };

export type QuoteResult = {
  lines: QuoteLineResult[];
  rmbSubtotal: Decimal;
  chinaCostsRmb: Decimal;
  grossWeightKg: Decimal;
  cartonCount: number;
  cbm: Decimal;
  shippingRmb: Decimal;
  totalRmb: Decimal;
  productCostBdt: Decimal;
  shippingBdt: Decimal;
  totalBdt: Decimal;
};

/**
 * China quotation maths:
 * - line total = unit price × qty; line weight = unit weight × qty;
 *   line CBM = (L × W × H / 1,000,000) × cartons
 * - shipping = total weight × rate/kg (air) or total CBM × rate/CBM (sea)
 * - total RMB = products + China costs + shipping; BDT at the locked rate.
 */
export function calcQuotation(q: QuoteInput, rate: DecimalLike): QuoteResult {
  const lines = q.lines.map((l) => {
    const cartons = l.cartonCount ?? 0;
    const perCarton = l.lengthCm && l.widthCm && l.heightCm ? D(l.lengthCm).mul(D(l.widthCm)).mul(D(l.heightCm)).div(1_000_000) : D(0);
    return {
      lineTotalRmb: money(D(l.unitPriceRmb).mul(l.quantity)),
      weightKg: D(l.unitWeightKg).mul(l.quantity).toDecimalPlaces(3),
      cbm: perCarton.mul(cartons).toDecimalPlaces(4),
    };
  });
  const rmbSubtotal = sum(lines.map((l) => l.lineTotalRmb));
  const chinaCostsRmb = sum([q.domesticShippingRmb, q.packingRmb, q.inspectionRmb, q.serviceFeeRmb]);
  const grossWeightKg = sum(lines.map((l) => l.weightKg));
  const cbm = sum(lines.map((l) => l.cbm));
  const shippingRmb = money(q.shippingMethod === "AIR" ? grossWeightKg.mul(D(q.shippingRatePerKgRmb)) : cbm.mul(D(q.shippingRatePerCbmRmb)));
  const totalRmb = rmbSubtotal.add(chinaCostsRmb).add(shippingRmb);
  const shippingBdt = rmbToBdt(shippingRmb, rate);
  const totalBdt = rmbToBdt(totalRmb, rate);
  return {
    lines,
    rmbSubtotal,
    chinaCostsRmb,
    grossWeightKg,
    cartonCount: q.lines.reduce((a, l) => a + (l.cartonCount ?? 0), 0),
    cbm,
    shippingRmb,
    totalRmb,
    productCostBdt: totalBdt.sub(shippingBdt),
    shippingBdt,
    totalBdt,
  };
}
