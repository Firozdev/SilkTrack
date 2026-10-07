import type { PortalAccountStatus, Prisma, RecordSource } from "@/generated/prisma/client";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { A, Badge, Card, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { matchingCustomers } from "@/server/portal-auth";
import { approveAction, rejectAction } from "./portal-actions";
import { PORTAL_BADGE, PORTAL_LABEL } from "./portal-labels";

const PORTAL_FILTERS: { value: PortalAccountStatus | "NONE"; label: string }[] = [
  { value: "ACTIVE", label: "Active portal users" },
  { value: "INVITED", label: "Invited (not joined yet)" },
  { value: "PENDING", label: "Pending approval" },
  { value: "NONE", label: "Not on portal" },
  { value: "DISABLED", label: "Disabled" },
  { value: "REJECTED", label: "Rejected" },
];

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePagePermission("request:edit");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const portal = PORTAL_FILTERS.find((f) => f.value === sp.portal)?.value;
  const source = (["PORTAL", "STAFF"] as RecordSource[]).find((s) => s === sp.source);

  const where: Prisma.CustomerWhereInput = {
    AND: [
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { code: { contains: q, mode: "insensitive" } }] } : {},
      portal === "NONE" ? { portalAccounts: { none: {} } } : portal ? { portalAccounts: { some: { status: portal } } } : {},
      source ? { source } : {},
    ],
  };
  const [customers, pending, counts] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        _count: { select: { orders: true, shippingOrders: true } },
        portalAccounts: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, lastLoginAt: true } },
      },
    }),
    prisma.portalAccount.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { customer: { select: { id: true, code: true } } } }),
    prisma.portalAccount.groupBy({ by: ["status"], _count: true }),
  ]);
  const matches = await Promise.all(pending.map((a) => (a.customerId ? Promise.resolve([]) : matchingCustomers(a.phone))));
  const count = (s: PortalAccountStatus) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="One list for everyone: customers we add, and customers who sign up in the portal (tagged 🌐 Portal). Invite existing customers from their page."
      />

      {pending.length > 0 && (
        <Card title={`Portal sign-ups waiting for approval (${pending.length})`} className="mb-5">
          <div className="space-y-3">
            {pending.map((a, i) => (
              <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div className="mb-2 text-sm">
                  <b>{a.name}</b> · {a.phone} {a.email && `· ${a.email}`} · signed up {fmtDateTime(a.createdAt, user.timezone)}
                  {a.customer && (
                    <>
                      {" "}
                      · customer <A href={`/customers/${a.customer.id}`}>{a.customer.code}</A>
                    </>
                  )}
                  <div className="text-xs text-gray-600">{[a.address, a.district, a.area].filter(Boolean).join(", ")}</div>
                </div>
                <div className="flex flex-wrap items-start gap-4">
                  <ActionForm action={approveAction} submitLabel="Approve" inline>
                    <input type="hidden" name="id" value={a.id} />
                    {!a.customerId && (
                      <select name="customerId" defaultValue={matches[i][0]?.id ?? "new"} className={`${inputCls} max-w-md`} aria-label="Customer">
                        {matches[i].map((c) => (
                          <option key={c.id} value={c.id}>
                            Link to {c.code} · {c.name} · {c.phone} (same phone)
                          </option>
                        ))}
                        <option value="new">Create a new customer from these details</option>
                      </select>
                    )}
                  </ActionForm>
                  <ActionForm action={rejectAction} submitLabel="Reject" variant="danger" inline>
                    <input type="hidden" name="id" value={a.id} />
                    <input name="reason" required placeholder="Reason (they see it)" className={`${inputCls} max-w-xs`} />
                  </ActionForm>
                </div>
                {!a.customerId && <p className="mt-1 text-xs text-amber-800">This phone already belongs to a customer. Check it is really them before linking the login to that customer.</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <form className="mb-3 flex flex-wrap gap-2">
          <input name="q" defaultValue={q} placeholder="Name, phone or code" className={`${inputCls} max-w-xs`} />
          <select name="portal" defaultValue={portal ?? ""} className={`${inputCls} max-w-[14rem]`} aria-label="Portal">
            <option value="">Portal: all</option>
            {PORTAL_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
                {f.value !== "NONE" ? ` (${count(f.value)})` : ""}
              </option>
            ))}
          </select>
          <select name="source" defaultValue={source ?? ""} className={`${inputCls} max-w-[12rem]`} aria-label="Joined via">
            <option value="">Joined via: all</option>
            <option value="PORTAL">Portal sign-up</option>
            <option value="STAFF">Added by staff</option>
          </select>
          <button className={btnCls}>Filter</button>
          {(q || portal || source) && (
            <Link href="/customers" className="self-center text-sm text-blue-700 hover:underline">
              Clear
            </Link>
          )}
        </form>
        <p className="mb-2 text-xs text-gray-500">{customers.length === 300 ? "Showing the newest 300 – narrow the filters to see more." : `${customers.length} customer(s)`}</p>
        <Table head={["Code", "Name", "Phone", "District / area", "Joined via", "Portal", "Last login", "Requests", "Shipping"]} empty="No customers match.">
          {customers.map((c) => {
            const acc = c.portalAccounts[0];
            return (
              <tr key={c.id}>
                <td className={tdCls}>
                  <A href={`/customers/${c.id}`}>{c.code}</A>
                </td>
                <td className={tdCls}>{c.name}</td>
                <td className={tdCls}>{c.phone}</td>
                <td className={tdCls}>{[c.district, c.area].filter(Boolean).join(" / ")}</td>
                <td className={tdCls}>{c.source === "PORTAL" ? <Badge value="PORTAL_SOURCE" label="🌐 Portal" /> : <span className="text-gray-500">Staff</span>}</td>
                <td className={tdCls}>{acc ? <Badge value={PORTAL_BADGE[acc.status]} label={PORTAL_LABEL[acc.status]} /> : <span className="text-gray-400">—</span>}</td>
                <td className={tdCls}>{acc?.lastLoginAt ? fmtDateTime(acc.lastLoginAt, user.timezone) : "—"}</td>
                <td className={tdCls}>{c._count.orders}</td>
                <td className={tdCls}>{c._count.shippingOrders}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
