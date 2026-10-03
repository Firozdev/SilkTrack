import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { docNo, humanize, parseDocNo } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { chinaInbox } from "@/server/requests";

const REQUEST_STATUSES = ["NEW", "SENT_TO_CHINA", "SAMPLING", "QUOTED", "CUSTOMER_APPROVED", "REJECTED", "CANCELLED"] as const;

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const rs = typeof sp.rs === "string" && (REQUEST_STATUSES as readonly string[]).includes(sp.rs) ? sp.rs : "";
  const type = sp.type === "SINGLE" || sp.type === "BULK" ? sp.type : "";

  const where: Prisma.OrderWhereInput = {};
  if (rs) where.requestStatus = rs as (typeof REQUEST_STATUSES)[number];
  if (type) where.type = type;
  if (q) {
    const n = parseDocNo(q);
    where.OR = [
      ...(n ? [{ number: n }, ...(/smp/i.test(q) ? [{ samples: { some: { number: n } } }] : [])] : []),
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { phone: { contains: q.replace(/\D/g, "") || q } } },
      { lines: { some: { productName: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }],
    take: 200,
    include: {
      customer: { select: { name: true, phone: true } },
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
      samples: { orderBy: { number: "asc" }, select: { id: true, number: true, status: true } },
    },
  });

  const upfront = can(user.role, "payment:record") ? (await chinaInbox()).awaitingAdvance : [];

  return (
    <>
      <PageHeader
        title="Product requests"
        actions={
          can(user.role, "request:edit") && (
            <Link href="/requests/new" className={btnPrimaryCls}>
              + New request
            </Link>
          )
        }
      />
      {upfront.length > 0 && (
        <Card title={`Upfront payments requested by China (${upfront.length})`} className="mb-5 border-amber-300">
          <Table head={["Order", "Customer", "Requested", "By", "Note"]}>
            {upfront.map((o) => (
              <tr key={o.id}>
                <td className={tdCls}>
                  <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
                </td>
                <td className={tdCls}>
                  {o.customer.name}
                  <div className="text-xs text-gray-400">{o.customer.phone}</div>
                </td>
                <td className={tdCls}>{fmtDateTime(o.advanceRequestedAt, user.timezone)}</td>
                <td className={tdCls}>{o.advanceRequestedBy?.name}</td>
                <td className={tdCls}>{o.advanceRequestNote}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card>
        <form className="mb-3 flex flex-wrap gap-2">
          <input name="q" defaultValue={q} placeholder="Search REQ/SMP no., customer, phone, product" className={`${inputCls} max-w-xs`} />
          <select name="rs" defaultValue={rs} className={`${inputCls} max-w-[12rem]`}>
            <option value="">All request statuses</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={type} className={`${inputCls} max-w-[9rem]`}>
            <option value="">Single + bulk</option>
            <option value="SINGLE">Single</option>
            <option value="BULK">Bulk</option>
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["No.", "Requested", "Customer", "Type", "Items", "Request", "Order status", "Samples", "By"]} empty="No requests found.">
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={tdCls}>
                <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
              </td>
              <td className={tdCls}>{fmtDateTime(o.requestedAt, user.timezone)}</td>
              <td className={tdCls}>
                {o.customer.name}
                <div className="text-xs text-gray-400">{o.customer.phone}</div>
              </td>
              <td className={tdCls}>
                {o.type === "BULK" ? "Bulk" : "Single"} · {o.shippingMethod === "AIR" ? "Air" : "Sea"}
              </td>
              <td className={tdCls}>{o._count.lines}</td>
              <td className={tdCls}>
                <Badge value={o.requestStatus} />
              </td>
              <td className={tdCls}>
                <Badge value={o.status} />
              </td>
              <td className={tdCls}>
                {o.samples.length === 0
                  ? "—"
                  : o.samples.map((smp) => (
                      <div key={smp.id} className="whitespace-nowrap">
                        <A href={`/samples/${smp.id}`}>{docNo("sample", smp.number)}</A> <span className="text-xs text-gray-500">{humanize(smp.status)}</span>
                      </div>
                    ))}
              </td>
              <td className={tdCls}>{o.createdBy.name}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
