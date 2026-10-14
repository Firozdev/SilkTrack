import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, inputCls } from "@/components/ui";
import { requirePagePermission } from "@/lib/session";
import { listPaymentAccounts } from "@/server/organization";
import { addPaymentAccountAction, deletePaymentAccountAction, movePaymentAccountAction, togglePaymentAccountAction, updatePaymentAccountAction } from "../actions";

const TYPE_LABEL = { BANK: "Bank", MOBILE_BANKING: "Mobile banking", OTHER: "Other" } as const;

type Account = Awaited<ReturnType<typeof listPaymentAccounts>>[number];

function AccountFields({ a }: { a?: Account }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type *">
          <select name="type" defaultValue={a?.type ?? "BANK"} className={inputCls}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bank / provider name *" hint="e.g. Dutch-Bangla Bank, bKash">
          <input name="providerName" required defaultValue={a?.providerName} className={inputCls} />
        </Field>
        <Field label="Account name *">
          <input name="accountName" required defaultValue={a?.accountName} className={inputCls} />
        </Field>
        <Field label="Account number *">
          <input name="accountNumber" required defaultValue={a?.accountNumber} className={inputCls} />
        </Field>
        <Field label="Branch">
          <input name="branch" defaultValue={a?.branch ?? ""} className={inputCls} />
        </Field>
        <Field label="Routing number">
          <input name="routingNumber" defaultValue={a?.routingNumber ?? ""} className={inputCls} />
        </Field>
      </div>
      <Field label="Notes" hint="e.g. Merchant account – use Payment, add your order number as reference">
        <input name="notes" defaultValue={a?.notes ?? ""} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="showOnPdf" defaultChecked={a?.showOnPdf ?? true} /> Show on PDFs
      </label>
    </>
  );
}

/** Payment accounts printed on PDFs (Admin only). */
export default async function PaymentAccountsPage() {
  await requirePagePermission("settings:manage");
  const accounts = await listPaymentAccounts();
  return (
    <div className="space-y-5">
      <Card title={`Payment accounts (${accounts.length})`}>
        <p className="mb-4 text-sm text-gray-500">Accounts with “Show on PDFs” are printed on quotations, invoices and payment receipts, in this order.</p>
        {accounts.length === 0 && <p className="text-sm text-gray-400">No payment accounts yet – add the first one below.</p>}
        <ul className="divide-y divide-gray-100">
          {accounts.map((a, i) => {
            const hid = <input type="hidden" name="id" value={a.id} />;
            return (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">
                      {a.providerName} <span className="font-normal text-gray-500">· {TYPE_LABEL[a.type]}</span> {a.showOnPdf ? <Badge value="COMPLETED" label="On PDFs" /> : <Badge value="CANCELLED" label="Hidden" />}
                    </div>
                    <div className="text-gray-700">
                      {a.accountName} · <span className="tabular-nums">{a.accountNumber}</span>
                    </div>
                    <div className="text-xs text-gray-500">{[a.branch && `Branch: ${a.branch}`, a.routingNumber && `Routing: ${a.routingNumber}`, a.notes].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={movePaymentAccountAction} submitLabel="▲" variant="default" inline>
                      {hid}
                      <input type="hidden" name="direction" value="up" />
                    </ActionForm>
                    <ActionForm action={movePaymentAccountAction} submitLabel="▼" variant="default" inline>
                      {hid}
                      <input type="hidden" name="direction" value="down" />
                    </ActionForm>
                    <ActionForm action={togglePaymentAccountAction} submitLabel={a.showOnPdf ? "Hide from PDFs" : "Show on PDFs"} variant="default" inline>
                      {hid}
                      <input type="hidden" name="show" value={a.showOnPdf ? "no" : "yes"} />
                    </ActionForm>
                    <ActionForm action={deletePaymentAccountAction} submitLabel="Delete" variant="danger" inline confirm={`Delete ${a.providerName} ${a.accountNumber}? It will no longer appear on PDFs.`}>
                      {hid}
                    </ActionForm>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-blue-700">Edit</summary>
                  <ActionForm action={updatePaymentAccountAction} submitLabel="Save account" className="mt-3 max-w-3xl">
                    {hid}
                    <AccountFields a={a} />
                  </ActionForm>
                </details>
                <span className="sr-only">Position {i + 1}</span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Add a payment account">
        <ActionForm action={addPaymentAccountAction} submitLabel="Add account" resetOnSuccess className="max-w-3xl">
          <AccountFields />
        </ActionForm>
      </Card>
    </div>
  );
}
