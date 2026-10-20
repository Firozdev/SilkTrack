import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, btnCls } from "@/components/ui";
import { UserError } from "@/lib/action";
import { fmtBdt } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import { TRASHABLE, isTrashable, previewDelete, type DeletePreview } from "@/server/trash";
import { moveToTrashAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Confirm a delete (Admin): shows everything that goes to Trash with the record. */
export default async function DeleteRecordPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePagePermission("record:delete");
  const sp = await searchParams;
  const type = String(sp.type ?? "");
  const id = String(sp.id ?? "");
  const back = typeof sp.back === "string" && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : null;
  if (!isTrashable(type) || !id) return <Alert tone="error">Nothing to delete.</Alert>;
  const def = TRASHABLE[type];
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
            {(pv.payments.count > 0 || pv.invoices > 0) && (
              <Alert tone="error">
                ⚠ This removes real money records from the reports and customer balances:
                {pv.payments.count > 0 && (
                  <>
                    {" "}
                    <b>
                      {pv.payments.count} payment{pv.payments.count === 1 ? "" : "s"} ({fmtBdt(pv.payments.totalBdt)})
                    </b>
                  </>
                )}
                {pv.invoices > 0 && (
                  <>
                    {pv.payments.count > 0 ? " and " : " "}
                    <b>
                      {pv.invoices} invoice{pv.invoices === 1 ? "" : "s"}
                    </b>
                  </>
                )}
                .
              </Alert>
            )}
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
