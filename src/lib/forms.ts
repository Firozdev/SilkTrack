import { z } from "zod";

/** Plain object of the single-valued fields in a FormData (files excluded). */
export function fields(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * Rows posted as `${prefix}.${index}.${field}` → array of objects, ordered by
 * index. Rows where every value is blank are dropped. Each row gets `_i`, its
 * original index (to match files posted as `${prefix}.${index}.<file field>`).
 */
export function rows(fd: FormData, prefix: string): Record<string, string>[] {
  const byIndex = new Map<number, Record<string, string>>();
  const re = new RegExp(`^${prefix}\\.(\\d+)\\.(.+)$`);
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const m = k.match(re);
    if (!m) continue;
    const i = Number(m[1]);
    const row = byIndex.get(i) ?? {};
    row[m[2]] = v;
    byIndex.set(i, row);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, r]) => Object.values(r).some((v) => v.trim() !== ""))
    .map(([i, r]) => ({ ...r, _i: String(i) }));
}

/** Uploaded files under `name` (empty file inputs are skipped). */
export function files(fd: FormData, name: string): File[] {
  return fd.getAll(name).filter((v): v is File => typeof v !== "string" && v.size > 0);
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Non-negative decimal as a string (Prisma accepts strings for Decimal). */
export const zDec = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a number");

export const zDecOpt = z.preprocess(blankToUndefined, zDec.optional());
export const zStrOpt = z.preprocess(blankToUndefined, z.string().trim().optional());
export const zIntPos = z.coerce.number().int().positive();
export const zIntMin0 = z.coerce.number().int().min(0);
export const zYmd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date");
export const zYmdOpt = z.preprocess(blankToUndefined, zYmd.optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
