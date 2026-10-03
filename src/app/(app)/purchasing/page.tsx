import type { PurchaseStatus } from "@/generated/prisma/client";
import { A, Badge, Card, PageHeader, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtRmb, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listPurchases, purchaseQueue } from "@/server/purchasing";
import { chinaInbox } from "@/server/requests";
import { ActionForm } from "@/components/action-form";
import { requestUpfrontAction } from "./actions";

const STATUSES: PurchaseStatus[] = ["PENDING", "PURCHASED", "SHIPPED_BY_SUPPLIER", "RECEIVED_AT_CHINA_WAREHOUSE", "OUT_OF_STOCK", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER"];

export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const [queue, purchases, inbox] = await Promise.all([purchaseQueue(), listPurchases(status ? { status } : {}), chinaInbox()]);
  const canBuy = can(user.role, "purchase:edit");
  const unrequested = [...new Map(queue.filter((l) => !l.advancePaid && !l.order.advanceRequestedAt).map((l) => [l.order.id, l.order])).values()];
  const pendingApproval = purchases.filter((p) => p.lines.some((l) => l.priceApproval === "PENDING"));

  return (
    <>
      <PageHeader title="China purchasing" subtitle="Approved, advance-paid lines waiting to be bought, and supplier orders." />

      {pendingApproval.length > 0 && can(user.role, "purchase:approvePriceChange") && (
        <Card title="Price changes waiting for your approval" className="mb-5 border-amber-300">
          <ul className="text-sm">
            {pendingApproval.map((p) => (
              <li key={p.id}>
                <A href={`/purchasing/${p.id}`}>{docNo("purchase", p.number)}</A> – {p.supplier.name}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Requests from Bangladesh (${inbox.sent.length})`} className="mb-5">
        <Table head={["Request", "Customer", "Type", "Lines", "Next step", "Requested"]} empty="No requests waiting for the China team.">
          {inbox.sent.map((o) => {
            return (
              <tr key={o.id}>
                <td className={tdCls}>
                  <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A>
                </td>
                <td className={tdCls}>{o.customer.code}</td>
                <td className={tdCls}>{o.type === "BULK" ? "Bulk" : "Single"}</td>
                <td className={tdCls}>{o.lines.length}</td>
                <td className={tdCls}>
                  {o.estimates.length ? (
                    <A href={`/estimates/new?order=${o.id}`}>Continue quotation</A>
                  ) : (
                    <A href={`/estimates/new?order=${o.id}`}>Prepare quotation →</A>
                  )}
                </td>
                <td className={tdCls}>{fmtDateTime(o.requestedAt, user.timezone)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={`Purchase queue (${queue.length})`} className="mb-5">
        <form action="/purchasing/new">
          <Table head={[canBuy ? "Buy" : "", "Order", "Priority", "Product", "Qty left", "Quoted", "Ship", "Upfront payment"]} empty="Nothing waiting for purchase.">
            {queue.map((l) => (
              <tr key={l.id}>
                <td className={tdCls}>
                  {canBuy && <input type="checkbox" name="lines" value={l.id} disabled={!l.advancePaid} aria-label={`Buy ${l.productName}`} title={l.advancePaid ? "" : "Waiting for upfront payment"} />}
                </td>
                <td className={tdCls}>
                  <A href={`/requests/${l.order.id}`}>{docNo("order", l.order.number)}</A>
                  <div className="text-xs text-gray-400">{l.order.customer.code}</div>
                </td>
                <td className={tdCls}>{l.order.priority}</td>
                <td className={tdCls}>
                  {l.productName}
                  <div className="text-xs text-gray-400">{[l.color, l.size, l.model].filter(Boolean).join(" · ")}</div>
                  {l.links[0] && (
                    <a href={l.links[0].url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">
                      {humanize(l.links[0].platform)} link
                    </a>
                  )}
                </td>
                <td className={tdCls}>
                  {l.remaining} / {l.quantity}
                </td>
                <td className={tdCls}>{fmtRmb(l.quotedUnitPriceRmb)}</td>
                <td className={tdCls}>{humanize(l.order.shippingMethod)}</td>
                <td className={tdCls}>
                  {l.advancePaid ? (
                    <Badge value="PAID" label="Confirmed by BD" />
                  ) : l.order.advanceRequestedAt ? (
                    <>
                      <Badge value="PENDING" label="Requested – waiting for BD" />
                      <div className="text-xs text-gray-400">{fmtDateTime(l.order.advanceRequestedAt, user.timezone)}</div>
                    </>
                  ) : (
                    <Badge value="NEW" label="Not requested" />
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {canBuy && queue.some((l) => l.advancePaid) && (
            <div className="mt-3">
              <button className={btnPrimaryCls}>Record purchase for selected lines →</button>
            </div>
          )}
        </form>
      </Card>

      {canBuy && unrequested.length > 0 && (
        <Card title="Request upfront payment" className="mb-5">
          <p className="mb-3 text-sm text-gray-500">The BD team collects the payment from the customer and confirms it; the lines then become available to buy.</p>
          <div className="space-y-2">
            {unrequested.map((o) => (
              <ActionForm key={o.id} action={requestUpfrontAction} submitLabel="Request upfront payment" inline resetOnSuccess>
                <input type="hidden" name="orderId" value={o.id} />
                <span className="min-w-[9rem] text-sm">
                  <A href={`/requests/${o.id}`}>{docNo("order", o.number)}</A> ({o.customer.code})
                </span>
                <input name="note" placeholder="Note for BD (optional)" className={`${inputCls} max-w-xs`} />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}

      <Card title="Supplier orders">
        <form className="mb-3 flex gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-xs`}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <button className={btnCls}>Filter</button>
        </form>
        <Table head={["Purchase", "Date", "Supplier", "Orders", "Total RMB", "Tracking", "Expected", "Status"]} empty="No purchases yet.">
          {purchases.map((p) => (
            <tr key={p.id}>
              <td className={tdCls}>
                <A href={`/purchasing/${p.id}`}>{docNo("purchase", p.number)}</A>
              </td>
              <td className={tdCls}>{fmtDateTime(p.purchaseDate, user.timezone)}</td>
              <td className={tdCls}>
                {p.supplier.name}
                <div className="text-xs text-gray-400">{humanize(p.platform)}</div>
              </td>
              <td className={tdCls}>{[...new Set(p.lines.map((l) => docNo("order", l.orderLine.order.number)))].join(", ")}</td>
              <td className={tdCls}>{fmtRmb(p.totalRmb)}</td>
              <td className={tdCls}>{p.trackingNo ? `${p.courierName ?? ""} ${p.trackingNo}` : "—"}</td>
              <td className={tdCls}>{fmtDay(p.expectedArrivalAt)}</td>
              <td className={tdCls}>
                <Badge value={p.status} />
                {p.lines.some((l) => l.priceApproval === "PENDING") && (
                  <div className="mt-1">
                    <Badge value="PRICE_CHANGED" label="Needs BD approval" />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
