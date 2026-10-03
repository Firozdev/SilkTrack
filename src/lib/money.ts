import { Decimal } from "@prisma/client/runtime/client";

export { Decimal };
export type DecimalLike = Decimal | string | number;

/** Decimal from anything; null/undefined/"" become 0. Never use JS floats for money. */
export function D(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

/** Round to 2 decimal places (half up) – money. */
export function money(value: DecimalLike): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** RMB × rate → BDT, rounded to 2 dp. */
export function rmbToBdt(rmb: DecimalLike, rate: DecimalLike): Decimal {
  return money(D(rmb).mul(D(rate)));
}

export function sum(values: (DecimalLike | null | undefined)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.add(D(v)), new Decimal(0));
}

/** CBM per carton = (L × W × H in cm) / 1,000,000, 4 dp. */
export function cbmOf(lengthCm: DecimalLike, widthCm: DecimalLike, heightCm: DecimalLike): Decimal {
  return D(lengthCm).mul(D(widthCm)).mul(D(heightCm)).div(1_000_000).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Split `total` across items in proportion to `weights`, rounded to `dp`
 * places. Rounding remainder goes to the largest item so the parts always add
 * up to the total exactly. If all weights are zero, splits equally.
 */
export function allocate(total: DecimalLike, weights: DecimalLike[], dp = 2): Decimal[] {
  if (weights.length === 0) return [];
  const t = D(total);
  let w = weights.map((x) => D(x));
  let totalWeight = sum(w);
  if (totalWeight.isZero()) {
    w = w.map(() => new Decimal(1));
    totalWeight = new Decimal(w.length);
  }
  const parts = w.map((x) => t.mul(x).div(totalWeight).toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  const remainder = t.sub(sum(parts));
  let largest = 0;
  w.forEach((x, i) => {
    if (x.gt(w[largest])) largest = i;
  });
  parts[largest] = parts[largest].add(remainder);
  return parts;
}

/** Percentage change from `from` to `to` (2 dp). Null when `from` is zero. */
export function pctChange(from: DecimalLike, to: DecimalLike): Decimal | null {
  const f = D(from);
  if (f.isZero()) return null;
  return D(to).sub(f).div(f).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
