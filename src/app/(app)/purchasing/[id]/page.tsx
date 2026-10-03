import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Attachments, Badge, Card, Dl, Field, PageHeader, Table, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, fmtNum, fmtRate, fmtRmb, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { decideAction, invoiceUploadAction, markPurchasedAction, problemAction, shippedAction } from "../actions";

export default async function PurchasePage({ params }: PageProps<"/purchasing/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const so = await prisma.supplierOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      purchasedBy: { select: { name: true } },
      attachments: { select: { id: true, fileName: true, mimeType: true } },
      receivings: { select: { id: true, number: true, receivedAt: true, condition: true } },
      lines: {
        include: {
          orderLine: { select: { productName: true, color: true, size: true, model: true, quantity: true, order: { select: { id: true, number: true } } } },
          priceApprovedBy: { select: { name: true } },
          receivingLines: { select: { quantityReceived: true } },
        },
      },
    },
  });
  if (!so) notFound();
  const canBuy = can(user.role, "purchase:edit");
  const canApprove = can(user.role, "purchase:approvePriceChange");
  const hid = <input type="hidden" name="id" value={so.id} />;
  const open = !["RECEIVED_AT_CHINA_WAREHOUSE", "OUT_OF_STOCK", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER"].includes(so.status);

  return (
    <>
      <PageHeader
        title={`${docNo("purchase", so.number)} · ${so.supplier.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={so.status} /> {humanize(so.platform)} · by {so.purchasedBy.name}, {fmtDateTime(so.purchaseDate, user.timezone)}
          </span>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Lines">
            <Table head={["Order", "Product", "Qty", "Quoted", "Actual", "Change", "Line total", "BDT", "Received"]}>
              {so.lines.map((l) => (
                <tr key={l.id}>
                  <td className={tdCls}>
                    <A href={`/requests/${l.orderLine.order.id}`}>{docNo("order", l.orderLine.order.number)}</A>
                  </td>
                  <td className={tdCls}>
                    {l.orderLine.productName}
                    <div className="text-xs text-gray-400">{[l.orderLine.color, l.orderLine.size, l.orderLine.model].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={tdCls}>{l.quantity}</td>
                  <td className={tdCls}>{fmtRmb(l.quotedUnitPriceRmb)}</td>
                  <td className={tdCls}>{fmtRmb(l.unitPriceRmb)}</td>
                  <td className={tdCls}>
                    {l.priceChangePct ? `${fmtNum(l.priceChangePct)}%` : "—"}
                    {l.priceApproval !== "NOT_REQUIRED" && (
                      <div className="mt-1">
                        <Badge value={l.priceApproval} label={l.priceApproval === "PENDING" ? "Needs BD approval" : `${humanize(l.priceApproval)}${l.priceApprovedBy ? ` by ${l.priceApprovedBy.name}` : ""}`} />
                      </div>
                    )}
                    {l.priceApproval === "PENDING" && canApprove && (
                      <div className="mt-2 flex gap-1">
                        <ActionForm action={decideAction} submitLabel="Approve" inline>
                          {hid}
                          <input type="hidden" name="purchaseLineId" value={l.id} />
                          <input type="hidden" name="decision" value="approve" />
                        </ActionForm>
                        <ActionForm action={decideAction} submitLabel="Reject" variant="danger" inline>
                          {hid}
                          <input type="hidden" name="purchaseLineId" value={l.id} />
                          <input type="hidden" name="decision" value="reject" />
                        </ActionForm>
                      </div>
                    )}
                  </td>
                  <td className={tdCls}>
                    {fmtRmb(l.totalRmb)}
                    <div className="text-xs text-gray-400">
                      incl. ship {fmtRmb(l.domesticShippingShareRmb)} + svc {fmtRmb(l.serviceChargeShareRmb)}
                    </div>
                  </td>
                  <td className={tdCls}>{fmtBdt(l.totalBdt)}</td>
                  <td className={tdCls}>
                    {l.receivingLines.reduce((a, r) => a + r.quantityReceived, 0)} / {l.quantity}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Supplier invoice / screenshots">
            <Attachments items={so.attachments} />
            {so.attachments.length === 0 && <p className="text-sm text-gray-400">Nothing uploaded.</p>}
            {canBuy && (
              <ActionForm action={invoiceUploadAction} submitLabel="Upload" inline className="mt-3" resetOnSuccess>
                {hid}
                <input type="file" name="invoice" accept="image/*,application/pdf" multiple required className="text-sm" />
              </ActionForm>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Cost">
            <Dl
              items={[
                ["Products", fmtRmb(so.productTotalRmb)],
                ["Domestic shipping", fmtRmb(so.domesticShippingRmb)],
                ["Service charge", fmtRmb(so.serviceChargeRmb)],
                ["Total RMB", <b key="t">{fmtRmb(so.totalRmb)}</b>],
                ["Rate used", fmtRate(so.rateUsed)],
                ["BDT equivalent", fmtBdt(so.totalBdt)],
                ["Supplier order no.", so.supplierOrderNo],
                ["Paid with", so.paymentMethod],
              ]}
            />
          </Card>
          <Card title="Order tracking (supplier → China warehouse)">
            <Dl
              items={[
                [
                  "Order tracking",
                  so.trackingUrl ? (
                    <a key="u" href={so.trackingUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      Open link ↗
                    </a>
                  ) : (
                    "—"
                  ),
                ],
                ["Estimated receive", fmtDay(so.expectedArrivalAt)],
                ["Courier", so.courierName],
                ["Tracking no.", so.trackingNo],
                ["Shipped", fmtDateTime(so.shippedAt, user.timezone)],
                ["Received", so.receivings.map((r) => docNo("receiving", r.number)).join(", ") || "—"],
              ]}
            />
            {canBuy && ["PURCHASED", "SHIPPED_BY_SUPPLIER"].includes(so.status) && (
              <ActionForm action={shippedAction} submitLabel="Save shipping" className="mt-3">
                {hid}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Courier">
                    <input name="courierName" defaultValue={so.courierName ?? ""} required className={inputCls} />
                  </Field>
                  <Field label="Tracking no.">
                    <input name="trackingNo" defaultValue={so.trackingNo ?? ""} required className={inputCls} />
                  </Field>
                </div>
                <Field label="Order tracking URL">
                  <input name="trackingUrl" type="url" defaultValue={so.trackingUrl ?? ""} className={inputCls} />
                </Field>
                <Field label="Estimated receive date">
                  <input type="date" name="expectedArrivalAt" defaultValue={so.expectedArrivalAt?.toISOString().slice(0, 10) ?? ""} className={inputCls} />
                </Field>
              </ActionForm>
            )}
          </Card>
          {canBuy && open && (
            <Card title="Actions">
              {so.status === "PENDING" && (
                <ActionForm action={markPurchasedAction} submitLabel="Purchase complete">
                  {hid}
                  <Field label="Order tracking URL *">
                    <input name="trackingUrl" type="url" required defaultValue={so.trackingUrl ?? ""} placeholder="https://" className={inputCls} />
                  </Field>
                  <Field label="Estimated receive date *">
                    <input name="expectedArrivalAt" type="date" required defaultValue={so.expectedArrivalAt?.toISOString().slice(0, 10) ?? ""} className={inputCls} />
                  </Field>
                  <p className="text-xs text-gray-500">Locks today&apos;s rate. Needs all flagged prices approved.</p>
                </ActionForm>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-red-700">Report a problem…</summary>
                <ActionForm action={problemAction} submitLabel="Update status" variant="danger" className="mt-2">
                  {hid}
                  <select name="status" className={inputCls}>
                    <option value="OUT_OF_STOCK">Out of stock</option>
                    <option value="PRICE_CHANGED">Price changed</option>
                    <option value="REFUND_FROM_SUPPLIER">Refund from supplier</option>
                  </select>
                  <input name="note" placeholder="Note" className={inputCls} />
                </ActionForm>
              </details>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
