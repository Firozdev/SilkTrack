import { D, type DecimalLike } from "./money";

function group(fixed: string): string {
  const [int, frac] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + grouped + (frac !== undefined ? "." + frac : "");
}

type Num = DecimalLike | null | undefined;

export const fmtNum = (v: Num, dp = 2) => (v === null || v === undefined ? "—" : group(D(v).toFixed(dp)));
function withSymbol(symbol: string, v: Num) {
  if (v === null || v === undefined) return "—";
  const d = D(v);
  return d.isNeg() ? `-${symbol}${fmtNum(d.abs())}` : `${symbol}${fmtNum(d)}`;
}

export const fmtBdt = (v: Num) => withSymbol("৳", v);
export const fmtRmb = (v: Num) => withSymbol("¥", v);
export const fmtRate = (v: Num) => (v === null || v === undefined ? "—" : D(v).toFixed(4));
export const fmtKg = (v: Num) => (v === null || v === undefined ? "—" : `${fmtNum(v, 3)} kg`);
export const fmtCbm = (v: Num) => (v === null || v === undefined ? "—" : `${fmtNum(v, 4)} m³`);

const PREFIX = {
  order: "REQ",
  purchase: "PUR",
  estimate: "EST",
  receiving: "RCV",
  invoice: "INV",
  delivery: "DLV",
  issue: "ISS",
  claim: "CLM",
  payment: "PAY",
  sample: "SMP",
} as const;

/** REQ-000123 etc. */
export function docNo(kind: keyof typeof PREFIX, n: number): string {
  return `${PREFIX[kind]}-${String(n).padStart(6, "0")}`;
}

/** Parse "REQ-000123", "req123" or "123" back to 123. */
export function parseDocNo(input: string): number | null {
  const m = input.trim().match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

const KEEP_CASE: Record<string, string> = { bd: "BD", china: "China", cbm: "CBM", rmb: "RMB", bdt: "BDT", redx: "RedX", bkash: "bKash" };

/** ENUM_VALUE → "Enum value" (keeps BD, China, CBM… capitalised). */
export function humanize(value: string): string {
  const s = value
    .replace(/_/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w) => KEEP_CASE[w] ?? w)
    .join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
