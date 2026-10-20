import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { A, Badge, Card, Field, Table, inputCls, tdCls } from "@/components/ui";
import { DeleteRecordLink } from "@/components/delete-record";
import type { Role } from "@/generated/prisma/enums";
import { fmtDateTime } from "@/lib/dates";
import { requirePagePermission } from "@/lib/session";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/lib/roles";
import { STAFF_ROLES, listPortalLogins, listStaff } from "@/server/users";
import { createAgentAction } from "../../agents/actions";
import { disableAction, resetLinkAction } from "../../customers/portal-actions";
import { createStaffAction, resetStaffPasswordAction, staffActiveAction, updateStaffAction } from "./actions";

const LOCALE_LABEL = { EN: "English", BN: "বাংলা", ZH_CN: "中文" } as const;

/** Settings → Users: staff logins (Admin, CS, China team, BD Warehouse) and portal logins (customers, agents). */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("user:manage");
  const tab = (await searchParams).tab === "portal" ? "portal" : "staff";
  const tabCls = (on: boolean) => `rounded-md px-3 py-1.5 text-sm ${on ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-600 hover:bg-gray-100"}`;

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <Link href="/settings/users" className={tabCls(tab === "staff")}>
          Staff
        </Link>
        <Link href="/settings/users?tab=portal" className={tabCls(tab === "portal")}>
          Customers &amp; agents
        </Link>
      </div>
      {tab === "staff" ? <Staff meId={me.id} role={me.role} tz={me.timezone} /> : <Portal role={me.role} tz={me.timezone} />}
    </div>
  );
}

async function Staff({ meId, role, tz }: { meId: string; role: Role; tz: string }) {
  const users = await listStaff();
  return (
    <>
      <Card title="Add a staff user">
        <ActionForm action={createStaffAction} submitLabel="Add user" resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name *">
            <input name="name" required maxLength={100} className={inputCls} />
          </Field>
          <Field label="Email (login) *">
            <input name="email" type="email" required className={inputCls} />
          </Field>
          <Field label="Role *">
            <select name="role" required defaultValue="" className={inputCls}>
              <option value="" disabled>
                Choose…
              </option>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Password" hint="Leave empty to create one – it's shown once after saving">
            <input name="password" type="text" minLength={8} autoComplete="new-password" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
            <input type="checkbox" name="canSetSellingPrice" /> China team: may set customer selling prices
          </label>
        </ActionForm>
      </Card>

      <Card title={`Staff users (${users.length})`}>
        <Table head={["User", "Role", "Status", "Last login", ""]}>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "bg-gray-50 text-gray-500"}>
              <td className={tdCls}>
                <b>{u.name}</b>
                {u.id === meId && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                <div className="text-xs text-gray-500">{u.email}</div>
              </td>
              <td className={tdCls}>
                {ROLE_LABEL[u.role]}
                {u.role === "PURCHASE" && u.canSetSellingPrice && <div className="text-xs text-gray-500">may set selling prices</div>}
              </td>
              <td className={tdCls}>
                <Badge value={u.active ? "ACTIVE" : "DISABLED"} />
              </td>
              <td className={`${tdCls} text-xs`}>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt, tz) : "never"}</td>
              <td className={tdCls}>
                <details>
                  <summary className="cursor-pointer text-sm text-blue-700">Manage</summary>
                  <div className="mt-2 w-72 space-y-3">
                    <ActionForm action={updateStaffAction} submitLabel="Save">
                      <input type="hidden" name="id" value={u.id} />
                      <Field label="Name">
                        <input name="name" defaultValue={u.name} required className={inputCls} />
                      </Field>
                      <Field label="Email">
                        <input name="email" type="email" defaultValue={u.email} required className={inputCls} />
                      </Field>
                      <Field label="Role">
                        <select name="role" defaultValue={u.role} className={inputCls}>
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Time zone">
                        <input name="timezone" defaultValue={u.timezone} className={inputCls} />
                      </Field>
                      <Field label="Language">
                        <select name="locale" defaultValue={u.locale} className={inputCls}>
                          {Object.entries(LOCALE_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input type="checkbox" name="canSetSellingPrice" defaultChecked={u.canSetSellingPrice} /> China team: may set selling prices
                      </label>
                    </ActionForm>
                    <ActionForm action={resetStaffPasswordAction} submitLabel="Reset password" variant="default">
                      <input type="hidden" name="id" value={u.id} />
                      <Field label="New password" hint="Empty = create one">
                        <input name="password" type="text" minLength={8} autoComplete="new-password" className={inputCls} />
                      </Field>
                    </ActionForm>
                    {u.id !== meId && (
                      <ActionForm action={staffActiveAction} submitLabel={u.active ? "Disable login" : "Enable login"} variant={u.active ? "danger" : "default"}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "no" : "yes"} />
                      </ActionForm>
                    )}
                    {u.id !== meId && <DeleteRecordLink role={role} type="User" id={u.id} back="/settings/users" small />}
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-gray-500">Disable users who did work, so their history stays. Only users with no history can be deleted. There is always at least one active Admin.</p>
      </Card>

      <Card title="Roles &amp; permissions">
        <div className="grid gap-4 sm:grid-cols-2">
          {STAFF_ROLES.map((r) => (
            <div key={r}>
              <div className="text-sm font-semibold">{ROLE_LABEL[r]}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                {ROLE_SUMMARY[r].map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <div className="text-sm font-semibold">Customer &amp; Agent (portal)</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
              <li>Log in with their mobile number in the customer portal</li>
              <li>Customers see only their own orders; an agent sees the customers assigned to them</li>
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}

async function Portal({ role, tz }: { role: Role; tz: string }) {
  const rows = await listPortalLogins();
  return (
    <>
      <Card title="Add an agent">
        <ActionForm action={createAgentAction} submitLabel="Create agent & invitation link" className="grid gap-3 sm:grid-cols-3">
          <Field label="Name *">
            <input name="name" required className={inputCls} />
          </Field>
          <Field label="Mobile (login) *">
            <input name="phone" required placeholder="01XXXXXXXXX" className={inputCls} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" className={inputCls} />
          </Field>
        </ActionForm>
        <p className="mt-2 text-xs text-gray-500">
          Customers sign up in the portal (you approve them on <A href="/customers">Customers</A>) or you invite them from a customer&apos;s page.
        </p>
      </Card>

      <Card title={`Customers & agents (${rows.length})`}>
        <Table head={["Login", "Type", "Status", "Last login", ""]}>
          {rows.map((a) => (
            <tr key={a.id} className={a.status === "ACTIVE" ? "" : "text-gray-500"}>
              <td className={tdCls}>
                <b>{a.name}</b>
                <div className="text-xs text-gray-500">
                  {a.phone}
                  {a.customer && (
                    <>
                      {" · "}
                      <A href={`/customers/${a.customer.id}`}>{a.customer.code}</A>
                    </>
                  )}
                </div>
              </td>
              <td className={tdCls}>{a.kind === "AGENT" ? "Agent" : "Customer"}</td>
              <td className={tdCls}>
                <Badge value={a.status} />
              </td>
              <td className={`${tdCls} text-xs`}>{a.lastLoginAt ? fmtDateTime(a.lastLoginAt, tz) : "never"}</td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-2">
                  {a.status === "PENDING" && <A href="/customers">Review sign-up</A>}
                  {a.status === "INVITED" && a.kind === "AGENT" && <A href="/agents">Resend invitation</A>}
                  {a.status === "ACTIVE" && (
                    <ActionForm action={resetLinkAction} submitLabel="Password link" variant="default" inline>
                      <input type="hidden" name="id" value={a.id} />
                    </ActionForm>
                  )}
                  {(a.status === "ACTIVE" || a.status === "DISABLED") && (
                    <ActionForm action={disableAction} submitLabel={a.status === "ACTIVE" ? "Disable" : "Enable"} variant={a.status === "ACTIVE" ? "danger" : "default"} inline>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="disabled" value={a.status === "ACTIVE" ? "yes" : "no"} />
                    </ActionForm>
                  )}
                  <DeleteRecordLink role={role} type="PortalAccount" id={a.id} back="/settings/users?tab=portal" small />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
