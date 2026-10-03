import { notFound } from "next/navigation";
import Link from "next/link";
import { A, Badge, Card, Dl, PageHeader, Table, btnCls, btnPrimaryCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { customerLedger } from "@/server/ledger";

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const user = await requirePagePermission("request:edit");
  const { id } = await params;
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: { orderBy: { requestedAt: "desc" }, include: { _count: { select: { lines: true } } } },
      samples: { orderBy: { requestedAt: "desc" }, include: { lines: true, order: { select: { number: true } } } },
    },
  });
  if (!c) notFound();
  const ledger = await customerLedger(c.id);
  return (
    <>
      <PageHeader
        title={`${c.name} (${c.code})`}
        actions={
          <>
            <Link href={`/samples/new?customer=${c.id}`} className={btnCls}>
              + New sample
            </Link>
            <Link href={`/requests/new?customer=${c.id}`} className={btnPrimaryCls}>
              + New request
            </Link>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Details">
          <Dl
            items={[
              ["Phone", c.phone],
              ["Email", c.email],
              ["Address", c.address],
              ["District / area", [c.district, c.area].filter(Boolean).join(" / ")],
            ]}
          />
        </Card>
        <Card title="Ledger" className="lg:col-span-2">
          <Dl
            items={[
              ["Invoiced", fmtBdt(ledger.invoiced)],
              ["Paid (advance + balance)", fmtBdt(ledger.paid)],
              ["Refunded", fmtBdt(ledger.refunded)],
              ["Balance due", <b key="b">{fmtBdt(ledger.balance)}</b>],
            ]}
          />
        </Card>
      </div>
      <Card title="Samples" className="mt-5">
        <Table head={["Sample", "Request", "Products", "Requested", "Status"]} empty="No samples.">
          {c.samples.map((smp) => (
            <tr key={smp.id}>
              <td className={tdCls}>
                <A href={`/samples/${smp.id}`}>{docNo("sample", smp.number)}</A>
              </td>
              <td className={tdCls}>{smp.order ? docNo("order", smp.order.number) : "—"}</td>
              <td className={tdCls}>{smp.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}</td>
              <td className={tdCls}>{fmtDateTime(smp.requestedAt, user.timezone)}</td>
              <td className={tdCls}>
                <Badge value={smp.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Orders" className="mt-5">
        <Table head={["No.", "Requested", "Items", "Request", "Status"]}>
          {c.orders.map((o) => (
            <tr key={o.id}>
              <td className={tdCls}>
                <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
              </td>
              <td className={tdCls}>{fmtDateTime(o.requestedAt, user.timezone)}</td>
              <td className={tdCls}>{o._count.lines}</td>
              <td className={tdCls}>
                <Badge value={o.requestStatus} />
              </td>
              <td className={tdCls}>
                <Badge value={o.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
