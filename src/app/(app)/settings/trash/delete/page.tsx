import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, btnCls } from "@/components/ui";
import { UserError } from "@/lib/action";
import { fmtBdt } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import type { CurrentUser } from "@/lib/session";
import { BULK_MAX, TRASHABLE, isTrashable, previewBulkDelete, previewDelete, tableNoun, type DeletePreview, type Trashable } from "@/server/trash";
import { moveManyToTrashAction, moveToTrashAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Confirm a delete (Admin): shows everything that goes to Trash with the record. */
export default async function DeleteRecordPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePagePermission("record:delete");
  const sp = await searchParams;
  const type = String(sp.type ?? "");
  const ids = ([] as string[]).concat(sp.id ?? []).filter(Boolean);
  const id = ids[0] ?? "";
  const back = typeof sp.back === "string" && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : null;
  if (!isTrashable(type) || !id) return <Alert tone="error">Nothing to delete.</Alert>;
  const def = TRASHABLE[type];
  if (ids.length > 1) return <BulkConfirm user={user} type={type} ids={ids} back={back ?? def.back} />;
  const cancelHref = back ?? (def.href ? def.href(id) : def.back);

  let pv: DeletePreview;
  try {
    pv = await previewDelete(user, type, id);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return (
      <>
        <Alert tone="error">{e.message}</Alert>
        <Link href={cancelHref} className={btnCls}>
          ← Back
        </Link>
      </>
    );
  }

  return (
    <Card title={`Delete ${def.noun}`}>
      <div className="max-w-2xl space-y-4 text-sm">
        <p className="text-base font-semibold text-gray-900">{pv.label}</p>
        {pv.blocked ? (
          <Alert tone="error">{pv.blocked}</Alert>
        ) : (
          <>
            {pv.counts.length > 0 ? (
              <div>
                <p className="font-medium text-gray-800">These are deleted with it:</p>
                <ul className="mt-1 list-disc pl-5 text-gray-700">
                  {pv.counts.map((c) => (
                    <li key={c.table}>
                      {c.count} {c.noun}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-gray-600">Nothing else is deleted with it.</p>
            )}
            {pv.unlinked.length > 0 && (
              <p className="text-gray-600">
                Kept, but no longer linked to it: {pv.unlinked.map((u) => `${u.count} ${u.noun}`).join(", ")}.
              </p>
            )}
            <MoneyWarning payments={pv.payments} invoices={pv.invoices} />
            <p className="text-gray-600">
              Everything goes to <b>Settings → Trash</b>. You can restore it from there, or delete it forever{pv.files > 0 && ` (that also removes ${pv.files} uploaded file${pv.files === 1 ? "" : "s"})`}.
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <ActionForm action={moveToTrashAction} submitLabel="Move to Trash" variant="danger" inline>
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="id" value={id} />
                {back && <input type="hidden" name="back" value={back} />}
              </ActionForm>
              <Link href={cancelHref} className={btnCls}>
                Cancel
              </Link>
            </div>
          </>
        )}
        {pv.blocked && (
          <Link href={cancelHref} className={btnCls}>
            ← Back
          </Link>
        )}
      </div>
    </Card>
  );
}

/** Money warning shared by the single and bulk confirmation. */
function MoneyWarning({ payments, invoices }: { payments: { count: number; totalBdt: string }; invoices: number }) {
  if (!payments.count && !invoices) return null;
  return (
    <Alert tone="error">
      ⚠ This removes real money records from the reports and customer balances:
      {payments.count > 0 && (
        <>
          {" "}
          <b>
            {payments.count} payment{payments.count === 1 ? "" : "s"} ({fmtBdt(payments.totalBdt)})
          </b>
        </>
      )}
      {invoices > 0 && (
        <>
          {payments.count > 0 ? " and " : " "}
          <b>
            {invoices} invoice{invoices === 1 ? "" : "s"}
          </b>
        </>
      )}
      .
    </Alert>
  );
}

/** Confirm deleting several records selected on a list. */
async function BulkConfirm({ user, type, ids, back }: { user: CurrentUser; type: Trashable; ids: string[]; back: string }) {
  if (ids.length > BULK_MAX) return <Alert tone="error">Select at most {BULK_MAX} records at a time.</Alert>;
  const pv = await previewBulkDelete(user, type, ids);
  const ok = pv.items.filter((i) => !i.skipped);
  const skipped = pv.items.filter((i) => i.skipped);
  const noun = TRASHABLE[type].noun;
  return (
    <Card title={`Delete ${ids.length} ${tableNoun(type, ids.length)}`}>
      <div className="max-w-3xl space-y-4 text-sm">
        {ok.length > 0 && (
          <div>
            <p className="font-medium text-gray-800">
              These {ok.length} go to Trash{ok.length === 1 ? "" : " (each on its own, so you can restore any one of them)"}:
            </p>
            <ul className="mt-1 max-h-64 list-disc overflow-y-auto pl-5 text-gray-700">
              {ok.map((i) => (
                <li key={i.id}>{i.label}</li>
              ))}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <Alert tone="warn">
            <p className="font-medium">
              {skipped.length} will be skipped (not deleted):
            </p>
            <ul className="mt-1 list-disc pl-5">
              {skipped.map((i) => (
                <li key={i.id}>
                  <b>{i.label}</b> – {i.skipped}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {ok.length > 0 ? (
          <>
            {pv.counts.length > 0 ? (
              <p className="text-gray-700">
                <span className="font-medium text-gray-800">Deleted with them:</span> {pv.counts.map((c) => `${c.count} ${c.noun}`).join(", ")}.
              </p>
            ) : (
              <p className="text-gray-600">Nothing else is deleted with them.</p>
            )}
            {pv.unlinked.length > 0 && <p className="text-gray-600">Kept, but no longer linked to them: {pv.unlinked.map((u) => `${u.count} ${u.noun}`).join(", ")}.</p>}
            <MoneyWarning payments={pv.payments} invoices={pv.invoices} />
            <p className="text-gray-600">
              Everything goes to <b>Settings → Trash</b>. You can restore it from there, or delete it forever{pv.files > 0 && ` (that also removes ${pv.files} uploaded file${pv.files === 1 ? "" : "s"})`}.
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <ActionForm action={moveManyToTrashAction} submitLabel={`Move ${ok.length} ${ok.length === 1 ? noun : tableNoun(type, ok.length)} to Trash`} variant="danger" inline>
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="back" value={back} />
                {ok.map((i) => (
                  <input key={i.id} type="hidden" name="id" value={i.id} />
                ))}
              </ActionForm>
              <Link href={back} className={btnCls}>
                Cancel
              </Link>
            </div>
          </>
        ) : (
          <Link href={back} className={btnCls}>
            ← Back
          </Link>
        )}
      </div>
    </Card>
  );
}
