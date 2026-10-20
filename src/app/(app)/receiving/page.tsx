import { BulkDeleteBar, SelectAll, SelectRow } from "@/components/bulk-select";
import Link from "next/link";
import { ScanInput } from "@/components/scan-input";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtCbm, fmtKg, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { findByTracking, listReceivings } from "@/server/receiving";
import { qaTodo } from "@/server/order-qa";
import { findShippingByTracking, shippingNo } from "@/server/shipping-orders";

export default async function ReceivingPage({ searchParams }: PageProps<"/receiving">) {
  const user = await requireUser();
  const bulk = can(user.role, "record:delete");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = (["READY_TO_SHIP", "IN_SHIPMENT", "REPACKED"] as const).find((s) => s === sp.status);
  const canReceive = can(user.role, "receiving:edit");

  const [qa, matches, shippingMatches, list, awaiting] = await Promise.all([
    qaTodo(),
    q ? findByTracking(q) : Promise.resolve([]),
    q ? findShippingByTracking(q) : Promise.resolve([]),
    listReceivings(status),
    prisma.supplierOrder.findMany({
      where: { status: { in: ["PURCHASED", "SHIPPED_BY_SUPPLIER"] } },
      orderBy: [{ expectedArrivalAt: "asc" }],
      take: 50,
      include: { supplier: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader title="China warehouse receiving" />
      {qa.length > 0 && (
        <Card title={`QA tests to do (${qa.length})`} className="mb-5 border-amber-300">
          <p className="mb-2 text-sm text-gray-500">The customer asked for a QA test. Record Pass / Fail with notes and photos on the request – the goods can&apos;t go into a shipment until then.</p>
          <Table head={["Request", "Customer", "Products"]}>
            {qa.map((o) => (
              <tr key={o.id}>
                <td className={tdCls}>
                  <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
                </td>
                <td className={tdCls}>{o.customer.code}</td>
                <td className={tdCls}>{o.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {canReceive && (
        <Card title="Receive a parcel" className="mb-5">
          <form className="flex max-w-xl flex-wrap gap-2 sm:flex-nowrap">
            <ScanInput name="q" defaultValue={q} placeholder="Scan or type the supplier tracking number" />
            <button className={btnPrimaryCls}>Find</button>
          </form>
          {q && (
            <div className="mt-3">
              {shippingMatches.length > 0 && (
                <ul className="mb-2 space-y-2">
                  {shippingMatches.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-blue-100 bg-blue-50/40 p-2 text-sm">
                      <span>
                        <b>{shippingNo(m)}</b> <Badge value="REQUESTED" label="Shipping service" /> · {m.customer.code} · {m.items.map((i) => `${i.productName} × ${i.quantity}${i.trackingNo ? ` (${i.trackingNo})` : ""}`).join(", ")}
                      </span>
                      <Link href={`/shipping-orders/${m.id}`} className={btnPrimaryCls}>
                        {m.status === "REQUESTED" ? "Receive →" : "Open →"}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {matches.length === 0 && shippingMatches.length === 0 ? (
                <p className="text-sm text-red-600">No purchase or shipping order found with tracking number “{q}”.</p>
              ) : (
                <ul className="space-y-2">
                  {matches.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 p-2 text-sm">
                      <span>
                        <b>{docNo("purchase", m.number)}</b> · {m.supplier.name} · {m.courierName} {m.trackingNo} ·{" "}
                        {m.lines.map((l) => `${l.orderLine.productName} ${l.received}/${l.quantity}`).join(", ")}
                      </span>
                      {m.status === "RECEIVED_AT_CHINA_WAREHOUSE" ? (
                        <Badge value={m.status} />
                      ) : (
                        <Link href={`/receiving/new?so=${m.id}`} className={btnPrimaryCls}>
                          Receive →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title={`Awaiting arrival (${awaiting.length})`} className="mb-5">
        <Table head={["Purchase", "Supplier", "Courier / tracking", "Expected", "Status", ""]} empty="Nothing on the way.">
          {awaiting.map((s) => {
            const late = s.expectedArrivalAt && s.expectedArrivalAt < new Date();
            return (
              <tr key={s.id}>
                <td className={tdCls}>
                  <A href={`/purchasing/${s.id}`}>{docNo("purchase", s.number)}</A>
                </td>
                <td className={tdCls}>{s.supplier.name}</td>
                <td className={tdCls}>{s.trackingNo ? `${s.courierName ?? ""} ${s.trackingNo}` : <span className="text-gray-400">no tracking yet</span>}</td>
                <td className={tdCls}>
                  {fmtDay(s.expectedArrivalAt)} {late && <Badge value="FAILED" label="Late" />}
                </td>
                <td className={tdCls}>
                  <Badge value={s.status} />
                </td>
                <td className={tdCls}>
                  {canReceive && (
                    <Link href={`/receiving/new?so=${s.id}`} className="text-sm text-blue-700 hover:underline">
                      Receive
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Received parcels">
        {bulk && <BulkDeleteBar formId="bulk-receiving" type="Receiving" back="/receiving" />}
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-xs`}>
            <option value="">All</option>
            <option value="READY_TO_SHIP">Ready to ship</option>
            <option value="IN_SHIPMENT">In shipment</option>
            <option value="REPACKED">Repacked</option>
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <form action="/receiving/repack">
          <Table head={[...(bulk ? [<SelectAll key="all" formId="bulk-receiving" />] : []), canReceive ? "Repack" : "", "Parcel", "Received", "Orders", "Weight", "CBM", "Method", "Shipment", "Status"]} empty="No parcels received yet.">
            {list.map((r) => (
              <tr key={r.id}>
                {bulk && (
                  <td className={tdCls}>
                    <SelectRow formId="bulk-receiving" id={r.id} />
                  </td>
                )}
                <td className={tdCls}>{canReceive && r.status !== "REPACKED" && <input type="checkbox" name="ids" value={r.id} aria-label="Select for repacking" />}</td>
                <td className={tdCls}>
                  <A href={`/receiving/${r.id}`}>{docNo("receiving", r.number)}</A>
                  {r.cartonMark && <div className="text-xs text-gray-400">{r.cartonMark}</div>}
                </td>
                <td className={tdCls}>
                  {fmtDateTime(r.receivedAt, user.timezone)}
                  <div className="text-xs text-gray-400">{r.receivedBy.name}</div>
                </td>
                <td className={tdCls}>{[...new Set(r.lines.map((l) => `${docNo("order", l.orderLine.order.number)} (${l.orderLine.order.customer.code})`))].join(", ")}</td>
                <td className={tdCls}>{fmtKg(r.grossWeightKg)}</td>
                <td className={tdCls}>{fmtCbm(r.cbm)}</td>
                <td className={tdCls}>{humanize(r.shippingMethod)}</td>
                <td className={tdCls}>{r.shipment ? <A href={`/shipments/${r.shipment.id}`}>{r.shipment.code}</A> : "—"}</td>
                <td className={tdCls}>
                  <Badge value={r.status} /> {r.condition !== "OK" && <Badge value={r.condition} />}
                </td>
              </tr>
            ))}
          </Table>
          {canReceive && list.some((r) => r.status !== "REPACKED") && (
            <button className={`${btnCls} mt-3`}>Repack selected parcels →</button>
          )}
        </form>
      </Card>
    </>
  );
}
