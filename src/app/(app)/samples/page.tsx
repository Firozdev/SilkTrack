import type { SampleStatus } from "@/generated/prisma/client";
import Link from "next/link";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { can } from "@/lib/permissions";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtRmb, humanize } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { SAMPLE_FLOW, listSamples, sampleNo } from "@/server/samples";

export default async function SamplesPage({ searchParams }: PageProps<"/samples">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = [...SAMPLE_FLOW, "CANCELLED"].find((s) => s === sp.status) as SampleStatus | undefined;
  const samples = await listSamples(status ? { status } : sp.all ? {} : { status: { notIn: ["DELIVERED", "CANCELLED"] } });
  return (
    <>
      <PageHeader
        title="Samples"
        subtitle="Requested from a quoted request or created on their own; tracked separately from orders."
        actions={
          can(user.role, "request:edit") && (
            <Link href="/samples/new" className={btnPrimaryCls}>
              + New sample
            </Link>
          )
        }
      />
      <Card>
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-xs`}>
            <option value="">Open samples</option>
            {[...SAMPLE_FLOW, "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["Sample", "Order", "Customer", "Products", "Invoice", "Shipping", "Requested", "Status"]} empty="No samples.">
          {samples.map((s) => (
            <tr key={s.id}>
              <td className={tdCls}>
                <A href={`/samples/${s.id}`}>{sampleNo(s)}</A>
              </td>
              <td className={tdCls}>{s.order ? <A href={`/requests/${s.order.id}`}>{docNo("order", s.order.number)}</A> : <span className="text-gray-400">No request</span>}</td>
              <td className={tdCls}>
                <A href={`/customers/${s.customer.id}`}>{s.customer.code}</A>
                <div className="text-xs text-gray-400">{s.customer.name}</div>
              </td>
              <td className={tdCls}>{s.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}</td>
              <td className={tdCls}>
                {fmtRmb(s.totalRmb)}
                {s.paymentRequired !== null && <div className="text-xs text-gray-400">{s.paymentRequired ? "payment first" : "no payment needed"}</div>}
              </td>
              <td className={tdCls}>
                {s.shippingMode ? humanize(s.shippingMode) : "—"}
                {s.etaBd && <div className="text-xs text-gray-400">ETA {fmtDay(s.etaBd)}</div>}
              </td>
              <td className={tdCls}>{fmtDateTime(s.requestedAt, user.timezone)}</td>
              <td className={tdCls}>
                <Badge value={s.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
