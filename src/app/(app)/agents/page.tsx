import { ActionForm } from "@/components/action-form";
import { A, Badge, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { listAgents } from "@/server/agents";
import { disableAction, resetLinkAction } from "../customers/portal-actions";
import { PORTAL_BADGE, PORTAL_LABEL } from "../customers/portal-labels";
import { assignAgentAction, createAgentAction, reinviteAgentAction } from "./actions";

/** Agents order in the portal for several customers. Admin only. */
export default async function AgentsPage() {
  const user = await requirePagePermission("agent:manage");
  const [agents, unassigned] = await Promise.all([
    listAgents(),
    prisma.customer.findMany({ where: { agentAccountId: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, code: true, name: true, phone: true } }),
  ]);

  return (
    <>
      <PageHeader title="Agents" subtitle="Our agents log in to the customer portal and place Buy for Me and Ship for Me requests for the customers assigned to them. They can also add new customers." />
      <Card title="New agent" className="mb-5">
        <ActionForm action={createAgentAction} submitLabel="Create agent and invitation link" resetOnSuccess className="max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name *">
              <input name="name" required className={inputCls} />
            </Field>
            <Field label="Mobile (login) *">
              <input name="phone" type="tel" required placeholder="01XXXXXXXXX" className={inputCls} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      </Card>

      {agents.length === 0 && <p className="text-sm text-gray-400">No agents yet.</p>}
      <div className="space-y-4">
        {agents.map((a) => {
          const hid = <input type="hidden" name="id" value={a.id} />;
          return (
            <Card
              key={a.id}
              title={
                <span>
                  {a.name} <span className="font-normal text-gray-500">· {a.phone}</span>
                </span>
              }
              actions={<Badge value={PORTAL_BADGE[a.status]} label={a.status === "ACTIVE" ? "Active" : PORTAL_LABEL[a.status]} />}
            >
              <p className="mb-3 text-xs text-gray-500">
                {a.agentCustomers.length} customer(s) · {a._count.placedOrders} Buy for Me · {a._count.placedShipping} Ship for Me placed · last login {a.lastLoginAt ? fmtDateTime(a.lastLoginAt, user.timezone) : "never"}
              </p>
              <div className="mb-4 flex flex-wrap gap-3">
                {a.status === "INVITED" && (
                  <ActionForm action={reinviteAgentAction} submitLabel="Resend invitation" variant="default" inline>
                    {hid}
                  </ActionForm>
                )}
                {a.status === "ACTIVE" && (
                  <>
                    <ActionForm action={resetLinkAction} submitLabel="Create password reset link" variant="default" inline>
                      {hid}
                    </ActionForm>
                    <ActionForm action={disableAction} submitLabel="Disable" variant="danger" inline confirm="Disable this agent? They are logged out at once.">
                      {hid}
                      <input type="hidden" name="disabled" value="yes" />
                    </ActionForm>
                  </>
                )}
                {a.status === "DISABLED" && (
                  <ActionForm action={disableAction} submitLabel="Enable" variant="default" inline>
                    {hid}
                    <input type="hidden" name="disabled" value="no" />
                  </ActionForm>
                )}
              </div>
              <ul className="mb-3 divide-y divide-gray-100 text-sm">
                {a.agentCustomers.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>
                      <A href={`/customers/${c.id}`}>{c.code}</A> {c.name} <span className="text-gray-500">· {c.phone}</span>
                    </span>
                    <ActionForm action={assignAgentAction} submitLabel="Remove" variant="default" inline confirm={`Remove ${c.name} from ${a.name}? The agent no longer sees their orders.`}>
                      <input type="hidden" name="customerId" value={c.id} />
                      <input type="hidden" name="agentId" value="" />
                    </ActionForm>
                  </li>
                ))}
              </ul>
              {unassigned.length > 0 && (
                <ActionForm action={assignAgentAction} submitLabel="Assign" variant="default" inline>
                  <input type="hidden" name="agentId" value={a.id} />
                  <select name="customerId" required defaultValue="" className={`${inputCls} max-w-sm`}>
                    <option value="" disabled>
                      Add an existing customer…
                    </option>
                    {unassigned.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name} · {c.phone}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
