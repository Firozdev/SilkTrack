import type { PortalAccountStatus } from "@/generated/prisma/client";
import { ActionForm } from "@/components/action-form";
import { A, Badge, Card, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import { listPortalAccounts, matchingCustomers } from "@/server/portal-auth";
import { approveAction, disableAction, rejectAction, resetLinkAction } from "./actions";

const STATUSES: PortalAccountStatus[] = ["PENDING", "ACTIVE", "DISABLED", "REJECTED"];

export default async function PortalAccountsPage({ searchParams }: PageProps<"/portal-accounts">) {
  const user = await requirePagePermission("request:edit");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const [pending, list] = await Promise.all([listPortalAccounts("PENDING"), status && status !== "PENDING" ? listPortalAccounts(status) : listPortalAccounts("ACTIVE")]);
  const matches = await Promise.all(pending.map((a) => matchingCustomers(a.phone)));

  return (
    <>
      <PageHeader title="Portal accounts" subtitle="Customers sign up at /portal/signup. Check who they are, then link the account to the right customer." />
      <Card title={`Waiting for approval (${pending.length})`} className="mb-5">
        {pending.length === 0 && <p className="text-sm text-gray-400">No new sign-ups.</p>}
        <div className="space-y-4">
          {pending.map((a, i) => (
            <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="mb-2 text-sm">
                <b>{a.name}</b> · {a.phone} {a.email && `· ${a.email}`} · signed up {fmtDateTime(a.createdAt, user.timezone)}
                <div className="text-xs text-gray-600">
                  {a.address}
                  {a.district && `, ${a.district}`}
                  {a.area && `, ${a.area}`}
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-4">
                <ActionForm action={approveAction} submitLabel="Approve" inline>
                  <input type="hidden" name="id" value={a.id} />
                  <select name="customerId" defaultValue={matches[i][0]?.id ?? "new"} className={`${inputCls} max-w-md`} aria-label="Customer">
                    {matches[i].map((c) => (
                      <option key={c.id} value={c.id}>
                        Link to {c.code} · {c.name} · {c.phone} (same phone)
                      </option>
                    ))}
                    <option value="new">Create new customer from these details</option>
                  </select>
                </ActionForm>
                <ActionForm action={rejectAction} submitLabel="Reject" variant="danger" inline>
                  <input type="hidden" name="id" value={a.id} />
                  <input name="reason" required placeholder="Reason (shown to them)" className={`${inputCls} max-w-xs`} />
                </ActionForm>
              </div>
              {matches[i].length === 0 && <p className="mt-1 text-xs text-gray-500">No customer with this phone yet. If they are an existing customer with another number, update the customer&apos;s phone first.</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status && status !== "PENDING" ? status : "ACTIVE"} className={`${inputCls} max-w-xs`}>
            {STATUSES.filter((s) => s !== "PENDING").map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["Name", "Phone", "Customer", "Reviewed", "Last login", "Status", ""]} empty="No accounts.">
          {list.map((a) => (
            <tr key={a.id}>
              <td className={tdCls}>{a.name}</td>
              <td className={tdCls}>{a.phone}</td>
              <td className={tdCls}>{a.customer ? <A href={`/customers/${a.customer.id}`}>{a.customer.code}</A> : "—"}</td>
              <td className={tdCls}>
                {a.reviewedAt ? `${fmtDateTime(a.reviewedAt, user.timezone)} · ${a.reviewedBy?.name ?? ""}` : "—"}
                {a.rejectReason && <div className="text-xs text-gray-500">{a.rejectReason}</div>}
              </td>
              <td className={tdCls}>{a.lastLoginAt ? fmtDateTime(a.lastLoginAt, user.timezone) : "never"}</td>
              <td className={tdCls}>
                <Badge value={a.status} />
              </td>
              <td className={tdCls}>
                {a.status === "ACTIVE" && (
                  <div className="space-y-2">
                    <ActionForm action={resetLinkAction} submitLabel="Create reset link" variant="default" inline>
                      <input type="hidden" name="id" value={a.id} />
                    </ActionForm>
                    <ActionForm action={disableAction} submitLabel="Disable" variant="danger" inline confirm="Disable this account? The customer is logged out at once.">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="disabled" value="yes" />
                    </ActionForm>
                  </div>
                )}
                {a.status === "DISABLED" && (
                  <ActionForm action={disableAction} submitLabel="Enable" variant="default" inline>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="disabled" value="no" />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
