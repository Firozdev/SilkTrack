import type { Decimal } from "@/lib/money";
import { fmtRmb } from "@/lib/format";

/** "Paid ¥1,050.00 · calculated ¥1,000.00 · +¥50.00" – the difference in amber when they don't match. */
export function PaidRmb({ paidRmb, totalRmb }: { paidRmb: Decimal | null; totalRmb: Decimal }) {
  if (!paidRmb) return <span className="text-gray-400">— (not recorded)</span>;
  const diff = paidRmb.sub(totalRmb);
  return (
    <span>
      <b>{fmtRmb(paidRmb)}</b>
      {!diff.isZero() && (
        <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800 ring-1 ring-inset ring-amber-200" title="Total paid to the supplier vs. unit price × qty + shipping + service">
          calculated {fmtRmb(totalRmb)} · {diff.isPos() ? "+" : "−"}
          {fmtRmb(diff.abs())}
        </span>
      )}
    </span>
  );
}
