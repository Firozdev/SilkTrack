import type { ShippingOrderStatus } from "@/generated/prisma/client";
import Link from "next/link";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { fmtCbm, fmtKg, humanize } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { SHIPPING_FLOW, listShippingOrders, shippingNo } from "@/server/shipping-orders";

const STATUSES: ShippingOrderStatus[] = [...SHIPPING_FLOW, "ON_HOLD", "CANCELLED"];

export default async function ShippingOrdersPage({ searchParams }: PageProps<"/shipping-orders">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const list = await listShippingOrders(status ? { status } : { status: { notIn: ["DELIVERED", "CANCELLED"] } });
  return (
    <>
      <PageHeader
        title="Shipping service"
        subtitle="The customer buys in China themselves; we receive at our China warehouse, ship, invoice and deliver."
        actions={
          can(user.role, "request:edit") && (
            <Link href="/shipping-orders/new" className={btnPrimaryCls}>
              + New shipping order
            </Link>
          )
        }
      />
      <Card>
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-xs`}>
            <option value="">Open orders</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["Order", "Customer", "Products", "Method", "China weight / CBM", "Shipment", "Created", "Status"]} empty="No shipping orders.">
          {list.map((s) => (
            <tr key={s.id}>
              <td className={tdCls}>
                <A href={`/shipping-orders/${s.id}`}>{shippingNo(s)}</A>
                {s.qaRequested && <div className="text-xs text-gray-400">QA {s.qaResult ? s.qaResult.toLowerCase() : "requested"}</div>}
              </td>
              <td className={tdCls}>
                <A href={`/customers/${s.customer.id}`}>{s.customer.code}</A>
                <div className="text-xs text-gray-400">{s.customer.name}</div>
              </td>
              <td className={tdCls}>{s.items.map((i) => `${i.productName} × ${i.quantity}`).join(", ")}</td>
              <td className={tdCls}>{humanize(s.shippingMethod)}</td>
              <td className={tdCls}>{s.grossWeightKg ? `${fmtKg(s.grossWeightKg)} · ${fmtCbm(s.cbm)}` : <span className="text-gray-400">not received</span>}</td>
              <td className={tdCls}>{s.shipment ? <A href={`/shipments/${s.shipment.id}`}>{s.shipment.code}</A> : "—"}</td>
              <td className={tdCls}>{fmtDateTime(s.createdAt, user.timezone)}</td>
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
