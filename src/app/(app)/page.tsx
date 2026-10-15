import { InboxPanel, Meter, StatTile, StatusBars, TileRow } from "@/components/dashboard";
import { A, Badge, Card, PageHeader, Table, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { adminInbox, bdDashboard, chinaDashboard, managementDashboard, ordersByStatus, warehouseDashboard } from "@/server/dashboard";
import { getCurrentRate } from "@/server/rates";

const days = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)} days`);

export default async function Dashboard() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const showBd = user.role === "CS" || isAdmin;
  const showChina = user.role === "PURCHASE" || isAdmin;

  const showWarehouse = user.role === "BD_WAREHOUSE" || isAdmin;
  const [inbox, statusRows, bd, china, mgmt, { isToday }, wh] = await Promise.all([
    can(user.role, "dashboard:adminInbox") ? adminInbox(user) : null,
    ordersByStatus(),
    showBd ? bdDashboard() : null,
    showChina ? chinaDashboard() : null,
    isAdmin && can(user.role, "report:profit") ? managementDashboard() : null,
    getCurrentRate(),
    showWarehouse ? warehouseDashboard() : null,
  ]);

  return (
    <>
      <PageHeader title={`Hello, ${user.name}`} subtitle={isAdmin ? "Management, Bangladesh and China overview" : user.role === "CS" ? "Bangladesh team dashboard" : user.role === "BD_WAREHOUSE" ? "Bangladesh warehouse dashboard" : "China team dashboard"} />

      {inbox && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">New Requests</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {inbox.map((p) => (
              <InboxPanel
                key={p.key}
                title={p.title}
                hint={p.hint}
                href={p.href}
                count={p.count}
                items={p.items.map((i) => ({ ...i, when: fmtDateTime(i.at, user.timezone) }))}
                empty="Nothing new."
              />
            ))}
          </div>
        </section>
      )}

      {mgmt && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Management</h2>
          <TileRow>
            <StatTile label={`Orders · ${mgmt.week.label}`} value={mgmt.week.orders} hint="customer-approved" />
            <StatTile label={`Revenue · ${mgmt.week.label}`} value={fmtBdt(mgmt.week.revenue)} />
            <StatTile label={`Orders · ${mgmt.month.label}`} value={mgmt.month.orders} hint="customer-approved" />
            <StatTile label={`Revenue · ${mgmt.month.label}`} value={fmtBdt(mgmt.month.revenue)} />
            <StatTile label={`Est. profit · ${mgmt.month.label}`} value={fmtBdt(mgmt.month.profit)} hint="purchased orders only" />
            <StatTile label="Today's rate" value={isToday ? "Entered" : "Missing"} tone={isToday ? "default" : "danger"} href="/settings/exchange-rates" />
          </TileRow>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Average lead time per leg">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span className="text-gray-600">Customer approval → purchase</span> <b>{days(mgmt.leadTimes.approvalToPurchase)}</b>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-600">Purchase → China warehouse</span> <b>{days(mgmt.leadTimes.supplierToChina)}</b>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-600">China → Bangladesh</span> <b>{days(mgmt.leadTimes.chinaToBd)}</b>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-600">Bangladesh → customer</span> <b>{days(mgmt.leadTimes.bdToCustomer)}</b>
                </li>
              </ul>
            </Card>
            <Card title="Profit by order (latest approved)" className="xl:col-span-2">
              <Table head={["Order", "Customer", "Selling", "China cost", "Freight", "Est. profit"]} empty="No approved orders yet.">
                {mgmt.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className={tdCls}>
                      <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
                    </td>
                    <td className={tdCls}>{o.customer}</td>
                    <td className={`${tdCls} tabular-nums`}>{fmtBdt(o.revenue)}</td>
                    <td className={`${tdCls} tabular-nums`}>{fmtBdt(o.chinaCost)}</td>
                    <td className={`${tdCls} tabular-nums`}>{fmtBdt(o.freight)}</td>
                    <td className={`${tdCls} tabular-nums font-medium ${o.profit?.isNeg() ? "text-red-700" : ""}`}>{o.profit ? fmtBdt(o.profit) : <span className="text-gray-400">not bought yet</span>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <Card title="Profit by shipment">
            <Table head={["Shipment", "Status", "Selling", "China cost", "Freight", "Est. profit"]} empty="No shipments with items yet.">
              {mgmt.byShipment.map((s) => (
                <tr key={s.id}>
                  <td className={tdCls}>
                    <A href={`/shipments/${s.id}`}>{s.code}</A>
                  </td>
                  <td className={tdCls}>
                    <Badge value={s.status} />
                  </td>
                  <td className={`${tdCls} tabular-nums`}>{fmtBdt(s.revenue)}</td>
                  <td className={`${tdCls} tabular-nums`}>{fmtBdt(s.chinaCost)}</td>
                  <td className={`${tdCls} tabular-nums`}>{s.freightKnown ? fmtBdt(s.freight) : <span className="text-gray-400">not entered</span>}</td>
                  <td className={`${tdCls} tabular-nums font-medium ${s.profit.isNeg() ? "text-red-700" : ""}`}>{fmtBdt(s.profit)}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-xs text-gray-400">Estimates from quoted selling prices, purchase costs at the locked rate and freight shares. Final figures come from invoices.</p>
          </Card>
        </section>
      )}

      {bd && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Bangladesh</h2>
          <TileRow>
            <StatTile label="With China team" value={bd.withChina} hint="new, being quoted" href="/requests?rs=NEW" />
            <StatTile label="Quotations to review" value={bd.quotationsToReview} hint="add selling price & send" href="/estimates?status=SUBMITTED_BY_CHINA" tone={bd.quotationsToReview ? "attention" : "default"} />
            <StatTile label="In sampling" value={bd.sampling} hint="sample in progress" href="/requests?rs=SAMPLING" />
            <StatTile label="Pending quotes" value={bd.quoted} hint="waiting for customer" href="/requests?rs=QUOTED" />
            <StatTile label="Upfront payments to collect" value={bd.upfrontRequested} hint="requested by China" href="/requests" tone={bd.upfrontRequested ? "attention" : "default"} />
            <StatTile label="Price changes to approve" value={bd.priceApprovals} href="/purchasing" tone={bd.priceApprovals ? "attention" : "default"} />
            <StatTile label="Balances to collect" value={fmtBdt(bd.balanceToCollect)} hint={`${bd.invoicesOpen} open invoice(s)`} />
          </TileRow>
        </section>
      )}

      {wh && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Bangladesh warehouse</h2>
          <TileRow>
            <StatTile label="Shipments on the way" value={wh.onTheWay} hint="departed / in transit" href="/shipments" />
            <StatTile label="Shipments in Bangladesh" value={wh.arrived} hint="arrived / customs cleared" href="/shipments" tone={wh.arrived ? "attention" : "default"} />
            <StatTile label="Orders on the way" value={wh.ordersInTransit} href="/requests?st=IN_TRANSIT" />
            <StatTile label="Bangladesh received" value={wh.ordersReceived} hint="customs clearance next" href="/requests?st=ARRIVED_BD" tone={wh.ordersReceived ? "attention" : "default"} />
            <StatTile label="Customs cleared" value={wh.ordersCustoms} hint="waiting for invoice / payment" href="/requests?st=CUSTOMS_CLEARED" />
            <StatTile label="Ready for home delivery" value={wh.ordersReady} hint="dispatch to courier" href="/requests?st=READY_FOR_DELIVERY" tone={wh.ordersReady ? "attention" : "default"} />
            <StatTile label="Out for delivery" value={wh.ordersOut} href="/requests?st=OUT_FOR_DELIVERY" />
            <StatTile label="Ship for Me to receive" value={wh.shippingToReceive} hint="in a shipment" href="/shipping-orders?status=IN_SHIPMENT" />
            <StatTile label="Ship for Me ready to dispatch" value={wh.shippingReady} href="/shipping-orders?status=READY_FOR_DELIVERY" tone={wh.shippingReady ? "attention" : "default"} />
            <StatTile label="Ship for Me out for delivery" value={wh.shippingOut} href="/shipping-orders?status=OUT_FOR_DELIVERY" />
          </TileRow>
        </section>
      )}

      {china && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">China</h2>
          <TileRow>
            <StatTile label="Requests to price / estimate" value={china.toPrice} href="/purchasing" tone={china.toPrice ? "attention" : "default"} />
            <StatTile label="Ready to buy" value={china.readyToBuy} hint="payment confirmed" href="/purchasing" tone={china.readyToBuy ? "attention" : "default"} />
            <StatTile label="Request upfront payment" value={china.needPaymentRequest} hint={`${china.waitingForPayment} waiting for BD`} href="/purchasing" />
            <StatTile label="Awaiting arrival" value={china.awaitingArrival} hint={china.lateArrivals ? `${china.lateArrivals} late` : "none late"} href="/receiving" tone={china.lateArrivals ? "danger" : "default"} />
            <StatTile label="Ready to ship" value={china.readyToShip} hint="not in a shipment" href="/receiving?status=READY_TO_SHIP" />
            <StatTile label="QA tests to do" value={china.qaToDo} hint="Buy for Me, received" href="/receiving" tone={china.qaToDo ? "attention" : "default"} />
            <StatTile label="Open China issues" value={china.openIssues} href="/issues?source=CHINA_RECEIVING" tone={china.openIssues ? "danger" : "default"} />
          </TileRow>
          <Card title="Current shipments – weight and CBM vs capacity">
            {china.shipments.length === 0 ? (
              <p className="text-sm text-gray-400">No open or upcoming shipment. One is created automatically when the next parcel is received.</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {china.shipments.map((s) => (
                  <div key={s.id} className="space-y-2 rounded-md border border-gray-100 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <A href={`/shipments/${s.id}`}>{s.code}</A>
                      <span className="text-xs text-gray-500">
                        cut-off {fmtDay(s.cutoffDate)} · {s.itemCount} parcels
                      </span>
                    </div>
                    <Meter label="Gross weight" value={s.grossWeightKg.toNumber()} max={s.maxWeightKg?.toNumber() ?? null} unit="kg" />
                    <Meter label="Volume" value={s.cbm.toNumber()} max={s.maxCbm?.toNumber() ?? null} unit="m³" />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      <Card title="Orders by status">
        <StatusBars rows={statusRows} />
      </Card>
    </>
  );
}
