import { ActionForm } from "@/components/action-form";
import { A, Alert, Attachments, Badge, Card, Field, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, humanize } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import { amountDue, defaultOrderPaymentType, duplicateReferences, listSubmissions, submissionNo } from "@/server/payment-submissions";
import { approveSubmissionAction, rejectSubmissionAction } from "./actions";

const METHODS = ["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "CARD", "OTHER"];

function target(s: { order: { id: string; number: number } | null; shippingOrder: { id: string; number: number } | null; sample: { id: string; number: number } | null }) {
  if (s.shippingOrder) return { href: `/shipping-orders/${s.shippingOrder.id}`, label: docNo("shippingOrder", s.shippingOrder.number), kind: "shipping" as const, id: s.shippingOrder.id };
  if (s.sample) return { href: `/samples/${s.sample.id}`, label: docNo("sample", s.sample.number), kind: "sample" as const, id: s.sample.id };
  return { href: `/requests/${s.order!.id}`, label: docNo("order", s.order!.number), kind: "order" as const, id: s.order!.id };
}

export default async function PaymentsToVerifyPage() {
  const user = await requirePagePermission("payment:record");
  const [pending, recent] = await Promise.all([listSubmissions({ status: "PENDING" }), listSubmissions({ status: { not: "PENDING" } }, 50)]);
  const extra = await Promise.all(
    pending.map(async (s) => {
      const t = target(s);
      const [dups, due, type] = await Promise.all([duplicateReferences(s.reference, s.id), amountDue(s.customerId, t), s.orderId ? defaultOrderPaymentType(s.orderId) : null]);
      return { t, dups, due, type };
    }),
  );

  return (
    <>
      <PageHeader title="Payments to verify" subtitle="Payments customers reported in the portal. Check each against the bKash / Nagad / bank statement before approving." />
      <Card title={`Waiting (${pending.length})`} className="mb-5">
        {pending.length === 0 && <p className="text-sm text-gray-400">Nothing to verify.</p>}
        <div className="space-y-4">
          {pending.map((s, i) => {
            const { t, dups, due, type } = extra[i];
            return (
              <div key={s.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    <b>{submissionNo(s)}</b> · <A href={t.href}>{t.label}</A> · <A href={`/customers/${s.customer.id}`}>{s.customer.code}</A> {s.customer.name} · {s.customer.phone}
                  </span>
                  <span className="text-xs text-gray-500">reported {fmtDateTime(s.createdAt, user.timezone)}</span>
                </div>
                <p className="text-sm">
                  <b className="text-base">{fmtBdt(s.amountBdt)}</b> by {humanize(s.method)} · TrxID <code className="rounded bg-white px-1">{s.reference}</code> · paid {fmtDay(s.paidAt)}
                  {due && <span className="ml-2 text-gray-500">(due on this bill: {fmtBdt(due.due)})</span>}
                </p>
                {s.note && <p className="text-sm text-gray-600">Note: {s.note}</p>}
                <Attachments items={s.attachments} />
                {(dups.payments > 0 || dups.submissions > 0) && (
                  <div className="mt-2">
                    <Alert tone="error">
                      ⚠ This transaction ID is already used on {dups.payments} recorded payment(s) and {dups.submissions} other report(s). Check it isn&apos;t the same payment twice.
                    </Alert>
                  </div>
                )}
                {!due && (
                  <div className="mt-2">
                    <Alert tone="warn">Nothing is due on this bill any more – it may already be paid. Reject this report unless you are sure.</Alert>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  <ActionForm action={approveSubmissionAction} submitLabel="Approve" inline confirm="Approve this payment? It will be recorded and counted.">
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Amount ৳">
                      <input name="amountBdt" defaultValue={s.amountBdt.toString()} inputMode="decimal" className={`${inputCls} max-w-[8rem]`} />
                    </Field>
                    <Field label="Method">
                      <select name="method" defaultValue={s.method} className={`${inputCls} max-w-[9rem]`}>
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {humanize(m)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reference">
                      <input name="reference" defaultValue={s.reference} className={`${inputCls} max-w-[11rem]`} />
                    </Field>
                    {type && (
                      <Field label="Type">
                        <select name="type" defaultValue={type} className={`${inputCls} max-w-[8rem]`}>
                          <option value="ADVANCE">Advance</option>
                          <option value="BALANCE">Balance</option>
                        </select>
                      </Field>
                    )}
                  </ActionForm>
                  <ActionForm action={rejectSubmissionAction} submitLabel="Reject" variant="danger" inline>
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Reason (customer sees it)">
                      <input name="reason" required className={`${inputCls} max-w-xs`} />
                    </Field>
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Recently reviewed">
        <Table head={["Report", "Bill", "Customer", "Amount", "TrxID", "Reviewed", "Status"]} empty="None yet.">
          {recent.map((s) => {
            const t = target(s);
            return (
              <tr key={s.id}>
                <td className={tdCls}>{submissionNo(s)}</td>
                <td className={tdCls}>
                  <A href={t.href}>{t.label}</A>
                </td>
                <td className={tdCls}>{s.customer.code}</td>
                <td className={tdCls}>
                  {fmtBdt(s.amountBdt)} <span className="text-xs text-gray-400">{humanize(s.method)}</span>
                </td>
                <td className={tdCls}>{s.reference}</td>
                <td className={tdCls}>
                  {s.reviewedAt ? `${fmtDateTime(s.reviewedAt, user.timezone)} · ${s.reviewedBy?.name ?? ""}` : "—"}
                  {s.rejectReason && <div className="text-xs text-red-700">{s.rejectReason}</div>}
                </td>
                <td className={tdCls}>
                  <Badge value={s.status} />
                </td>
              </tr>
            );
          })}
        </Table>
        <a href="/payments-to-verify" className={`${btnCls} mt-3 inline-block`}>
          Refresh
        </a>
      </Card>
    </>
  );
}
