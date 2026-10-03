import Link from "next/link";
import type { EstimateStatus } from "@/generated/prisma/client";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, fmtRmb, humanize } from "@/lib/format";
import { can, canSeeSelling } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const STATUSES: EstimateStatus[] = ["DRAFT", "SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER", "APPROVED", "REVISED", "REJECTED"];

export default async function QuotationsPage({ searchParams }: PageProps<"/estimates">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const showSelling = canSeeSelling(user);
  const [toQuote, list] = await Promise.all([
    can(user.role, "estimate:edit")
      ? prisma.order.findMany({
          where: { requestStatus: "SENT_TO_CHINA", status: { not: "ON_HOLD" }, estimates: { none: { status: { in: ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"] } } } },
          orderBy: [{ priority: "desc" }, { requestedAt: "asc" }],
          include: { customer: { select: { code: true } }, _count: { select: { lines: true } }, estimates: { where: { status: "DRAFT" }, select: { version: true } } },
        })
      : Promise.resolve([]),
    prisma.estimate.findMany({
      where: { status: status ?? { not: "REVISED" } },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { order: { select: { id: true, number: true, type: true, customer: { select: { code: true, name: true } } } }, createdBy: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader title="China quotations" subtitle="China prices products, weight, CBM and shipping; Bangladesh adds selling prices and sends to the customer." />
      {can(user.role, "estimate:edit") && (
        <Card title={`Requests to quote (${toQuote.length})`} className="mb-5">
          <Table head={["Request", "Customer", "Type", "Products", "Requested", ""]} empty="No requests waiting for a quotation.">
            {toQuote.map((o) => (
              <tr key={o.id}>
                <td className={tdCls}>
                  <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
                </td>
                <td className={tdCls}>{o.customer.code}</td>
                <td className={tdCls}>{humanize(o.type)}</td>
                <td className={tdCls}>{o._count.lines}</td>
                <td className={tdCls}>{fmtDateTime(o.requestedAt, user.timezone)}</td>
                <td className={tdCls}>
                  <Link href={`/estimates/new?order=${o.id}`} className={btnPrimaryCls}>
                    {o.estimates.length ? `Continue draft v${o.estimates[0].version}` : "Prepare quotation"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title="Quotations">
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-xs`}>
            <option value="">All current</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["Quotation", "Request", "Customer", "Total RMB", "Weight / CBM", ...(showSelling ? ["Selling"] : []), "Valid until", "Status"]} empty="No quotations yet.">
          {list.map((e) => (
            <tr key={e.id}>
              <td className={tdCls}>
                <A href={`/estimates/${e.id}`}>
                  {docNo("estimate", e.number)} v{e.version}
                </A>
                <div className="text-xs text-gray-400">{e.createdBy.name}</div>
              </td>
              <td className={tdCls}>
                <A href={`/requests/${e.order.id}`}>{docNo("order", e.order.number)}</A>
              </td>
              <td className={tdCls}>{e.order.customer.code}</td>
              <td className={`${tdCls} tabular-nums`}>{fmtRmb(e.totalRmb)}</td>
              <td className={tdCls}>
                {e.grossWeightKg.toString()} kg · {e.cbm.toString()} m³
              </td>
              {showSelling && <td className={`${tdCls} tabular-nums`}>{fmtBdt(e.grandTotalBdt)}</td>}
              <td className={tdCls}>{fmtDay(e.validUntil)}</td>
              <td className={tdCls}>
                <Badge value={e.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
