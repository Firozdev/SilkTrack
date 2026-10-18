import { ActionForm } from "@/components/action-form";
import { Card, Field, inputCls } from "@/components/ui";
import { BD_TZ, fmtDateTime, fmtDay, toYmd, today } from "@/lib/dates";
import { fmtBdt } from "@/lib/format";
import { D, type Decimal } from "@/lib/money";
import { portalPaymentAction, portalReceiptAction } from "../actions";
import { fill, type Dict, type Lang } from "../i18n";
import { portalLabel } from "../labels";
import { PayAmount, type PayChoice } from "./pay-amount";

type Kind = "order" | "shipping" | "sample";
type Submission = { id: string; number: number; amountBdt: Decimal; method: string; reference: string; paidAt: Date; status: "PENDING" | "APPROVED" | "REJECTED"; rejectReason: string | null };
const METHODS = ["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "OTHER"];
const SUB_CLS = { PENDING: "text-amber-700", APPROVED: "text-green-700", REJECTED: "text-red-700" } as const;

/** Pending reports count towards the product first, then the shipping. */
function payChoices(t: Dict, parts: { productDue: Decimal; shippingDue: Decimal }, pending: Decimal): PayChoice[] {
  const product = D(parts.productDue).sub(pending);
  const shipping = D(parts.shippingDue).sub(product.isNeg() ? product.neg() : 0);
  const p = product.isNeg() ? D(0) : product;
  const sh = shipping.isNeg() ? D(0) : shipping;
  if (p.gt(0)) return [{ key: "PRODUCT", label: t.payProductOnly, amount: p.toFixed(2) }, ...(sh.gt(0) ? [{ key: "BOTH", label: t.payProductShipping, amount: p.add(sh).toFixed(2) }] : [])];
  return sh.gt(0) ? [{ key: "SHIPPING", label: t.payShippingOnly, amount: sh.toFixed(2) }] : [];
}

/** "I have paid" form plus the payments the customer already reported. */
export function PaymentBox({
  t,
  lang,
  kind,
  id,
  due,
  submissions,
  parts,
}: {
  t: Dict;
  lang: Lang;
  kind: Kind;
  id: string;
  due: Decimal | null;
  submissions: Submission[];
  /** Sample: product and shipping still due – the customer pays product only or product + shipping. */
  parts?: { productDue: Decimal; shippingDue: Decimal };
}) {
  const pending = submissions.filter((s) => s.status === "PENDING").reduce((a, s) => a.add(s.amountBdt), D(0));
  const open = due ? due.sub(pending) : null;
  if (!submissions.length && !(due && due.gt(0))) return null;
  return (
    <Card title={t.payTitle}>
      {due && due.gt(0) && (
        <p className="mb-2 text-sm">
          <b>{fill(t.amountDue, { amount: fmtBdt(due) })}</b>
          {pending.gt(0) && <span className="ml-2 text-amber-700">{fill(t.pendingNote, { amount: fmtBdt(pending) })}</span>}
        </p>
      )}
      {open && open.gt(0) && (
        <details className="mb-3" open={!submissions.length}>
          <summary className="cursor-pointer text-sm font-medium text-blue-700">{t.iHavePaid}</summary>
          <p className="mt-1 text-xs text-gray-500">{t.payIntro}</p>
          <ActionForm action={portalPaymentAction} submitLabel={t.submitPayment} className="mt-2" resetOnSuccess>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-2 sm:grid-cols-2">
              <PayAmount label={t.amount} legend={t.payFor} choices={parts && payChoices(t, parts, pending)} initial={open.toFixed(2)} />
              <Field label={t.method}>
                <select name="method" className={inputCls}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {portalLabel(m, lang)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.reference}>
                <input name="reference" required minLength={4} autoComplete="off" className={inputCls} />
              </Field>
              <Field label={t.paidOn}>
                <input name="paidAt" type="date" required defaultValue={toYmd(today(BD_TZ))} className={inputCls} />
              </Field>
              <Field label={t.notes}>
                <input name="note" className={inputCls} />
              </Field>
              <Field label={t.screenshot}>
                <input type="file" name="photos" accept="image/*,application/pdf" className="text-sm" />
              </Field>
            </div>
          </ActionForm>
        </details>
      )}
      {submissions.length > 0 && (
        <>
          <div className="text-xs font-medium text-gray-500">{t.yourPayments}</div>
          <ul className="mt-1 space-y-1 text-sm">
            {submissions.map((s) => (
              <li key={s.id}>
                {fmtDay(s.paidAt)} · <b>{fmtBdt(s.amountBdt)}</b> · {portalLabel(s.method, lang)} · {s.reference} ·{" "}
                <span className={`font-medium ${SUB_CLS[s.status]}`}>{t[`sub${s.status}`]}</span>
                {s.rejectReason && <span className="text-red-700"> – {s.rejectReason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** "I received it" + note / problem; shows what the customer already said. */
export function ReceiptBox({
  t,
  kind,
  id,
  canConfirm,
  confirmedAt,
  note,
  problem,
}: {
  t: Dict;
  kind: Kind;
  id: string;
  canConfirm: boolean;
  confirmedAt: Date | null;
  note: string | null;
  problem: boolean;
}) {
  if (!canConfirm && !confirmedAt) return null;
  return (
    <Card title={t.receivedTitle}>
      {confirmedAt ? (
        <div className="mb-2 text-sm">
          <p className="text-green-700">✓ {fill(t.confirmedOn, { date: fmtDateTime(confirmedAt, BD_TZ) })}</p>
          {problem && <p className="font-medium text-red-700">⚠ {t.problemReported}</p>}
          {note && (
            <p className="mt-1 whitespace-pre-line text-gray-700">
              <span className="text-xs text-gray-500">{t.yourNote}:</span> {note}
            </p>
          )}
        </div>
      ) : (
        <p className="mb-2 text-sm text-gray-600">{t.receivedIntro}</p>
      )}
      {canConfirm && (
        <details open={!confirmedAt}>
          {confirmedAt && <summary className="cursor-pointer text-sm text-blue-700">{t.addNote}</summary>}
          <ActionForm action={portalReceiptAction} submitLabel={confirmedAt ? t.addNote : t.iReceived} className="mt-2" resetOnSuccess>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <Field label={t.receiptNote}>
              <textarea name="note" rows={2} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="problem" className="h-4 w-4" /> {t.hasProblem}
            </label>
            <Field label={t.problemPhotos}>
              <input type="file" name="photos" accept="image/*" capture="environment" multiple className="text-sm" />
            </Field>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
