import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDay } from "@/lib/dates";
import { fmtCbm, fmtKg, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { SHIPMENT_FLOW } from "@/server/shipments";

function Usage({ value, max }: { value: Prisma.Decimal; max: Prisma.Decimal | null }) {
  if (!max || max.isZero()) return null;
  const pct = Math.min(100, value.div(max).mul(100).toNumber());
  const over = value.gt(max);
  return (
    <div className="mt-1 h-1.5 w-24 rounded bg-gray-100" title={`${pct.toFixed(0)}% of capacity`}>
      <div className={`h-1.5 rounded ${over ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function ShipmentsPage({ searchParams }: PageProps<"/shipments">) {
  const user = await requireUser();
  const sp = await searchParams;
  const method = sp.method === "AIR" || sp.method === "SEA" ? sp.method : undefined;
  const status = SHIPMENT_FLOW.find((s) => s === sp.status);
  const shipments = await prisma.shipment.findMany({
    where: { method, status: status ?? (sp.all ? undefined : { not: "COMPLETED" }) },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }, { method: "asc" }],
    take: 100,
  });

  return (
    <>
      <PageHeader
        title="Weekly shipments"
        subtitle="Received items are attached to the open shipment of their method until its cut-off."
        actions={
          can(user.role, "shipment:edit") && (
            <Link href="/shipments/new" className={btnPrimaryCls}>
              + Plan shipment
            </Link>
          )
        }
      />
      <div className="grid gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-4">
          <form className="mb-3 flex flex-wrap gap-2">
            <select name="method" defaultValue={method ?? ""} className={`${inputCls} max-w-[8rem]`}>
              <option value="">Air + sea</option>
              <option value="AIR">Air</option>
              <option value="SEA">Sea</option>
            </select>
            <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-[12rem]`}>
              <option value="">Active</option>
              {SHIPMENT_FLOW.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <button className={btnCls}>Filter</button>
          </form>
          <Table head={["Shipment", "Cut-off", "Departure", "ETA BD", "Items", "Gross", "CBM", "Status"]} empty="No shipments yet – they are created automatically when the first item is received.">
            {shipments.map((s) => (
              <tr key={s.id}>
                <td className={tdCls}>
                  <A href={`/shipments/${s.id}`}>{s.code}</A>
                  <div className="text-xs text-gray-400">{s.forwarder}</div>
                </td>
                <td className={tdCls}>{fmtDay(s.cutoffDate)}</td>
                <td className={tdCls}>{fmtDay(s.departedAt ?? s.plannedDepartureDate)}</td>
                <td className={tdCls}>{fmtDay(s.arrivedAt ?? s.etaBd)}</td>
                <td className={tdCls}>
                  {s.itemCount} parcels · {s.cartonCount} ctn
                </td>
                <td className={tdCls}>
                  {fmtKg(s.grossWeightKg)}
                  <Usage value={s.grossWeightKg} max={s.maxWeightKg} />
                </td>
                <td className={tdCls}>
                  {fmtCbm(s.cbm)}
                  <Usage value={s.cbm} max={s.maxCbm} />
                </td>
                <td className={tdCls}>
                  <Badge value={s.status} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
