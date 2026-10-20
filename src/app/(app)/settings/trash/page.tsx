import { ActionForm } from "@/components/action-form";
import { Card, Table, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { requirePagePermission } from "@/lib/session";
import { listTrash, tableNoun } from "@/server/trash";
import { deleteForeverAction, emptyTrashAction, restoreAction } from "./actions";

/** "2 product lines, 1 quotation, 3 files" – what went to Trash with the record. */
function includes(entityType: string, summary: unknown): string {
  const parts = Object.entries(summary as Record<string, number>)
    .map(([t, n]) => [t, t === entityType ? n - 1 : n] as const)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, n]) => `${n} ${tableNoun(t, n)}`);
  return parts.join(", ") || "—";
}

/** Settings → Trash (Admin): restore deleted records or delete them forever. */
export default async function TrashPage() {
  const user = await requirePagePermission("record:delete");
  const items = await listTrash(user);
  return (
    <Card
      title={`Trash (${items.length})`}
      actions={
        items.length > 0 && (
          <ActionForm action={emptyTrashAction} submitLabel="Empty trash" variant="danger" inline confirm={`Delete all ${items.length} items forever? This can't be undone.`} />
        )
      }
    >
      <p className="mb-3 text-sm text-gray-600">
        Deleted records stay here until you delete them forever. <b>Restore</b> puts a record back exactly as it was, with everything that was deleted with it.
      </p>
      <Table head={["Deleted", "What", "Deleted with it", ""]} empty="Trash is empty.">
        {items.map((i) => (
          <tr key={i.id}>
            <td className={`${tdCls} whitespace-nowrap text-xs`}>
              {fmtDateTime(i.deletedAt, user.timezone)}
              <div className="text-gray-500">by {i.deletedBy?.name ?? "—"}</div>
            </td>
            <td className={tdCls}>
              <b>{i.label}</b>
            </td>
            <td className={`${tdCls} text-xs text-gray-600`}>{includes(i.entityType, i.summary)}</td>
            <td className={tdCls}>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={restoreAction} submitLabel="Restore" variant="default" inline>
                  <input type="hidden" name="id" value={i.id} />
                </ActionForm>
                <ActionForm action={deleteForeverAction} submitLabel="Delete forever" variant="danger" inline confirm={`Delete “${i.label}” forever? This can't be undone.`}>
                  <input type="hidden" name="id" value={i.id} />
                </ActionForm>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
