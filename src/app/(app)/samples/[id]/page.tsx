import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Alert, Attachments, Badge, Card, Dl, Field, PageHeader, btnCls, inputCls } from "@/components/ui";
import { fmtDateTime, fmtDay, toYmd } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg, fmtNum, fmtRate, fmtRmb, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { sampleAmounts, sampleInvoiceMessage, sampleNo } from "@/server/samples";
import { whatsappLink } from "@/lib/notify";
import { sum } from "@/lib/money";
import Link from "next/link";
import { SendInvoice } from "./send-invoice";
import { acceptingShipments } from "@/server/shipments";
import { cancelAction, deliverAction, paymentAction, photoAction, purchaseAction, receiveAction } from "../actions";
import { SampleInvoiceForm, SampleShipForm } from "./sample-forms";
import { Step, Waiting } from "./step";

export default async function SamplePage({ params }: PageProps<"/samples/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const s = await prisma.sample.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, number: true } },
      customer: { select: { id: true, name: true, code: true, phone: true, email: true } },
      requestedBy: { select: { name: true } },
      invoicedBy: { select: { name: true } },
      purchasedBy: { select: { name: true } },
      shipment: { select: { id: true, code: true } },
      lines: true,
      events: { orderBy: { occurredAt: "asc" }, include: { createdBy: { select: { name: true } } } },
      payments: { orderBy: { paidAt: "asc" } },
      attachments: { select: { id: true, fileName: true, mimeType: true } },
    },
  });
  if (!s) notFound();
  const china = can(user.role, "purchase:edit");
  const bd = can(user.role, "request:edit");
  const hid = <input type="hidden" name="id" value={s.id} />;
  const open = !["DELIVERED", "CANCELLED"].includes(s.status);
  const shipments = china && ["PURCHASED", "SHIPPED"].includes(s.status) ? await acceptingShipments() : [];
  const paid = sum(s.payments.map((p) => (p.type === "REFUND" ? p.amountBdt.neg() : p.amountBdt)));
  const amt = sampleAmounts(s, paid);
  const invoiceText = sampleInvoiceMessage(s, s.customer.name, paid);
  const methods = ["BKASH", "NAGAD", "ROCKET", "CASH", "BANK_TRANSFER", "CARD", "OTHER"];
  const str = (v: { toString(): string } | null) => (v === null ? "" : v.toString());
  const sizeInit = { weightKg: str(s.weightKg), cartonCount: s.cartonCount ? String(s.cartonCount) : "", lengthCm: str(s.lengthCm), widthCm: str(s.widthCm), heightCm: str(s.heightCm) };

  return (
    <>
      <PageHeader
        title={`${sampleNo(s)} · ${s.order ? docNo("order", s.order.number) : "No request"}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={s.status} /> <A href={`/customers/${s.customer.id}`}>{s.customer.name} ({s.customer.code})</A> · requested by {s.requestedBy.name}, {fmtDateTime(s.requestedAt, user.timezone)}
          </span>
        }
        actions={s.order && <A href={`/requests/${s.order.id}`}>Open request →</A>}
      />
      {s.status === "CANCELLED" && <Alert tone="error">This sample was cancelled – see the tracking below for the reason.</Alert>}
      {s.requestNote && <Alert tone="info">Request note: {s.requestNote}</Alert>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Products">
            <ul className="space-y-1 text-sm">
              {s.lines.map((l) => (
                <li key={l.id}>
                  {l.productName} {l.variant && <span className="text-gray-500">{l.variant}</span>} × <b>{l.quantity}</b>
                  {l.link && (
                    <a href={l.link} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-700 hover:underline">
                      link ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-2">
            {/* 1. Invoice (China) */}
            <Step
              n={1}
              title="Sample invoice"
              state={s.totalRmb ? "done" : open ? "current" : "todo"}
              summary={
                s.totalRmb
                  ? `${fmtRmb(s.totalRmb)} · ${fmtBdt(s.totalBdt)} · ${s.paymentRequired ? "payment first" : "no payment needed"}`
                  : "China prepares the invoice"
              }
            >
              {china && open && ["REQUESTED", "INVOICED", "AWAITING_PAYMENT"].includes(s.status) ? (
                <SampleInvoiceForm
                  id={s.id}
                  init={{
                    productRmb: str(s.productRmb),
                    chinaShippingRmb: str(s.chinaShippingRmb),
                    shippingToBdRmb: str(s.shippingToBdRmb),
                    serviceRmb: str(s.serviceRmb),
                    paymentRequired: s.paymentRequired,
                    shippingRatePerKgRmb: str(s.shippingRatePerKgRmb),
                    shippingRatePerCbmRmb: str(s.shippingRatePerCbmRmb),
                  }}
                  size={sizeInit}
                />
              ) : s.totalRmb ? (
                <p className="text-sm text-gray-600">See the invoice details on the right. {china && "The invoice can no longer be changed."}</p>
              ) : (
                <Waiting who="China" what="prepare the sample invoice" />
              )}
            </Step>

            {/* 2. Payment (BD) */}
            <Step
              n={2}
              title="Customer payment"
              state={
                !s.totalRmb
                  ? "todo"
                  : s.paymentRequired === false && paid.isZero()
                    ? "skipped"
                    : s.status === "AWAITING_PAYMENT"
                      ? "current"
                      : "done"
              }
              summary={
                !s.totalRmb
                  ? undefined
                  : s.status === "AWAITING_PAYMENT"
                    ? `${fmtBdt(amt.upfrontDue)} to collect before purchase${paid.gt(0) ? ` (paid ${fmtBdt(paid)})` : ""}`
                    : paid.gt(0)
                      ? `Paid ${fmtBdt(paid)}${amt.balance.gt(0) ? ` · due ${fmtBdt(amt.balance)}` : " · fully paid"}`
                      : "Not required before purchase"
              }
            >
              {bd && can(user.role, "payment:record") && s.status !== "CANCELLED" && s.totalBdt && amt.balance.gt(0) ? (
                <ActionForm action={paymentAction} submitLabel="Confirm payment received" inline resetOnSuccess>
                  {hid}
                  <p className="w-full text-xs text-gray-500">
                    Before purchase {fmtBdt(amt.beforePurchase)} · on delivery {fmtBdt(amt.onDelivery)} · paid {fmtBdt(paid)} · balance {fmtBdt(amt.balance)}
                  </p>
                  <input name="amountBdt" required defaultValue={(amt.upfrontDue.gt(0) ? amt.upfrontDue : amt.balance).toString()} inputMode="decimal" className={`${inputCls} max-w-[9rem]`} aria-label="Amount BDT" />
                  <select name="method" className={`${inputCls} max-w-[9rem]`} aria-label="Method">
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {humanize(m)}
                      </option>
                    ))}
                  </select>
                  <input name="reference" placeholder="Reference" className={`${inputCls} max-w-[10rem]`} />
                </ActionForm>
              ) : s.status === "AWAITING_PAYMENT" ? (
                <Waiting who="Bangladesh" what="confirm the customer's payment" />
              ) : (
                <p className="text-sm text-gray-600">{paid.gt(0) ? `Payments received: ${fmtBdt(paid)}.` : "China chose to buy without waiting for payment."}</p>
              )}
            </Step>

            {/* 3. Purchase (China) */}
            <Step
              n={3}
              title="Purchase in China"
              state={s.purchasedAt ? "done" : open && ["INVOICED", "PAID"].includes(s.status) ? "current" : "todo"}
              summary={s.purchasedAt ? `${s.supplierName} · est. receive ${fmtDay(s.expectedAtWarehouseAt)}` : undefined}
            >
              {s.purchasedAt ? (
                <Dl
                  items={[
                    ["Supplier", s.supplierName],
                    ["Supplier order no.", s.supplierOrderNo],
                    ["Order tracking", s.purchaseTrackingUrl ? <a key="u" href={s.purchaseTrackingUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Open ↗</a> : "—"],
                    ["Purchased", `${fmtDateTime(s.purchasedAt, user.timezone)} · ${s.purchasedBy?.name ?? ""}`],
                  ]}
                />
              ) : china ? (
                <ActionForm action={purchaseAction} submitLabel="Sample purchased">
                  {hid}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Supplier / shop *">
                      <input name="supplierName" required className={inputCls} />
                    </Field>
                    <Field label="Supplier order no.">
                      <input name="supplierOrderNo" className={inputCls} />
                    </Field>
                    <Field label="Order tracking URL *">
                      <input name="purchaseTrackingUrl" type="url" required placeholder="https://" className={inputCls} />
                    </Field>
                    <Field label="Estimated receive date (China) *">
                      <input name="expectedAtWarehouseAt" type="date" required className={inputCls} />
                    </Field>
                  </div>
                </ActionForm>
              ) : (
                <Waiting who="China" what="buy the sample" />
              )}
            </Step>

            {/* 4. Ship to Bangladesh (China) */}
            <Step
              n={4}
              title="Ship to Bangladesh"
              state={s.shippedAt ? "done" : open && s.status === "PURCHASED" ? "current" : "todo"}
              summary={
                s.shippedAt
                  ? `${s.shipment ? `Planned shipment ${s.shipment.code}` : s.shippingMode ? humanize(s.shippingMode) : ""}${s.trackingNo ? ` · ${s.trackingNo}` : ""} · ETA ${fmtDay(s.etaBd)}`
                  : undefined
              }
            >
              {china && open && ["PURCHASED", "SHIPPED"].includes(s.status) ? (
                <SampleShipForm
                  id={s.id}
                  init={{
                    shippingMode: s.shippingMode,
                    shipmentId: s.shipmentId,
                    carrierName: s.carrierName ?? "",
                    trackingNo: s.trackingNo ?? "",
                    trackingUrl: s.trackingUrl ?? "",
                    etaBd: s.etaBd ? toYmd(s.etaBd) : "",
                  }}
                  size={sizeInit}
                  shipments={[
                    ...(s.shipment && !shipments.some((x) => x.id === s.shipment!.id) ? [{ id: s.shipment.id, label: s.shipment.code }] : []),
                    ...shipments.map((x) => ({ id: x.id, label: `${x.code} · cut-off ${fmtDay(x.cutoffDate)} · ETA ${fmtDay(x.etaBd)}` })),
                  ]}
                />
              ) : s.shippedAt ? (
                <p className="text-sm text-gray-600">Shipping details are on the right.</p>
              ) : (
                <Waiting who="China" what="send the sample" />
              )}
            </Step>

            {/* 5. Received in Bangladesh (BD) */}
            <Step
              n={5}
              title="Received in Bangladesh"
              state={s.receivedBdAt ? "done" : open && s.status === "SHIPPED" ? "current" : "todo"}
              summary={s.receivedBdAt ? fmtDateTime(s.receivedBdAt, user.timezone) : s.status === "SHIPPED" ? `ETA ${fmtDay(s.etaBd)}` : undefined}
            >
              {s.receivedBdAt ? (
                <p className="text-sm text-gray-600">Received {fmtDateTime(s.receivedBdAt, user.timezone)}.</p>
              ) : bd ? (
                <ActionForm action={receiveAction} submitLabel="Sample received in Bangladesh">
                  {hid}
                </ActionForm>
              ) : (
                <Waiting who="Bangladesh" what="receive the sample" />
              )}
            </Step>

            {/* 6. Delivered (BD) */}
            <Step
              n={6}
              title="Delivered to customer"
              state={s.deliveredAt ? "done" : open && s.status === "RECEIVED_BD" ? "current" : "todo"}
              summary={
                s.deliveredAt
                  ? `${fmtDateTime(s.deliveredAt, user.timezone)}${s.customerFeedback ? ` · “${s.customerFeedback}”` : ""}${amt.balance.gt(0) ? ` · ${fmtBdt(amt.balance)} still due` : ""}`
                  : s.totalBdt && amt.balance.gt(0)
                    ? `${fmtBdt(amt.balance)} to collect on delivery`
                    : undefined
              }
            >
              {s.deliveredAt ? (
                <p className="text-sm text-gray-600">Customer feedback: {s.customerFeedback ?? "—"}</p>
              ) : bd ? (
                <ActionForm action={deliverAction} submitLabel={amt.balance.gt(0) ? "Payment collected & delivered" : "Delivered to customer"}>
                  {hid}
                  {amt.balance.gt(0) && can(user.role, "payment:record") && (
                    <div>
                      <p className="mb-1 text-sm">
                        Due on delivery: <b>{fmtBdt(amt.balance)}</b> <span className="text-gray-500">(shipping {fmtBdt(amt.onDelivery)})</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input name="amountBdt" defaultValue={amt.balance.toString()} inputMode="decimal" className={`${inputCls} max-w-[9rem]`} aria-label="Amount collected (BDT)" />
                        <select name="method" className={`${inputCls} max-w-[9rem]`} aria-label="Method">
                          {methods.map((m) => (
                            <option key={m} value={m}>
                              {humanize(m)}
                            </option>
                          ))}
                        </select>
                        <input name="reference" placeholder="Reference" className={`${inputCls} max-w-[10rem]`} />
                      </div>
                      <p className="mt-1 text-xs text-gray-400">Clear the amount to deliver without collecting; the balance stays due.</p>
                    </div>
                  )}
                  <Field label="Customer feedback">
                    <textarea name="feedback" rows={2} className={inputCls} />
                  </Field>
                </ActionForm>
              ) : (
                <Waiting who="Bangladesh" what="deliver the sample" />
              )}
            </Step>
          </div>

          <Card title="Sample tracking">
            <ol className="space-y-2 border-l border-gray-200 pl-4">
              {s.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
                  <div className="text-xs text-gray-500">
                    {fmtDateTime(e.occurredAt, user.timezone)}
                    {e.createdBy && <> · {e.createdBy.name}</>}
                  </div>
                  <div>
                    {e.status && <Badge value={e.status} />} {e.message}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Invoice"
            actions={
              s.totalBdt && (
                <Link href={`/samples/${s.id}/invoice`} target="_blank" className={btnCls}>
                  🖨 Print / PDF
                </Link>
              )
            }
          >
            {bd && s.totalBdt && (
              <div className="mb-3">
                <SendInvoice
                  sampleId={s.id}
                  whatsappUrl={whatsappLink(s.customer.phone, invoiceText)}
                  mailtoUrl={s.customer.email ? `mailto:${s.customer.email}?subject=${encodeURIComponent(`Sample invoice ${sampleNo(s)}`)}&body=${encodeURIComponent(invoiceText)}` : null}
                />
                <p className="mt-1 text-xs text-gray-400">Save the PDF first and attach it in WhatsApp / email.</p>
              </div>
            )}
            <Dl
              items={[
                ["Sample price", fmtRmb(s.productRmb)],
                ["China shipping", fmtRmb(s.chinaShippingRmb)],
                [
                  "Shipping to BD",
                  `${fmtRmb(s.shippingToBdRmb)}${s.shippingRatePerKgRmb ? ` @ ¥${fmtNum(s.shippingRatePerKgRmb)}/kg` : s.shippingRatePerCbmRmb ? ` @ ¥${fmtNum(s.shippingRatePerCbmRmb)}/m³` : ""}`,
                ],
                ["Service", fmtRmb(s.serviceRmb)],
                ["Total", <b key="t">{fmtRmb(s.totalRmb)}</b>],
                ["Rate", fmtRate(s.rateUsed)],
                ["Total BDT", <b key="b">{fmtBdt(s.totalBdt)}</b>],
                ["Before purchase", fmtBdt(amt.beforePurchase)],
                ["On delivery (shipping)", fmtBdt(amt.onDelivery)],
                ["Payment first?", s.paymentRequired === null ? "—" : s.paymentRequired ? "Yes" : "No"],
                ["Invoiced", s.invoicedAt ? `${fmtDateTime(s.invoicedAt, user.timezone)} · ${s.invoicedBy?.name ?? ""}` : "—"],
                ...(bd
                  ? ([
                      ["Paid", fmtBdt(paid)],
                      ["Balance due", <b key="d" className={amt.balance.gt(0) ? "text-red-700" : "text-green-700"}>{fmtBdt(amt.balance)}</b>],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
          </Card>
          <Card title="Purchase & shipping">
            <Dl
              items={[
                ["Supplier", s.supplierName],
                ["Order tracking", s.purchaseTrackingUrl ? <a key="u" href={s.purchaseTrackingUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Open ↗</a> : "—"],
                ["Est. receive (China)", fmtDay(s.expectedAtWarehouseAt)],
                ["Purchased", s.purchasedAt ? `${fmtDateTime(s.purchasedAt, user.timezone)} · ${s.purchasedBy?.name ?? ""}` : "—"],
                ["Size", s.weightKg || s.cbm ? `${fmtKg(s.weightKg)} · ${s.cartonCount ?? 1} ctn${s.lengthCm ? ` · ${fmtNum(s.lengthCm, 1)}×${fmtNum(s.widthCm, 1)}×${fmtNum(s.heightCm, 1)} cm` : ""} · ${fmtCbm(s.cbm)}` : "—"],
                ["Sent by", s.shippingMode ? (s.shippingMode === "WEEKLY_SHIPMENT" ? "Planned shipment" : humanize(s.shippingMode)) : "—"],
                ["Shipment", s.shipment ? <A key="s" href={`/shipments/${s.shipment.id}`}>{s.shipment.code}</A> : "—"],
                ["Carrier", s.carrierName],
                ["Tracking", s.trackingUrl ? <a key="t" href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{s.trackingNo ?? "Open ↗"}</a> : s.trackingNo],
                ["ETA Bangladesh", fmtDay(s.etaBd)],
                ["Received BD", fmtDateTime(s.receivedBdAt, user.timezone)],
                ["Delivered", fmtDateTime(s.deliveredAt, user.timezone)],
                ["Customer feedback", s.customerFeedback],
              ]}
            />
          </Card>
          <Card title="Photos">
            <Attachments items={s.attachments} />
            <ActionForm action={photoAction} submitLabel="Upload" inline className="mt-2" resetOnSuccess>
              {hid}
              <input type="file" name="photos" accept="image/*,application/pdf" capture="environment" multiple required className="text-sm" />
            </ActionForm>
          </Card>
          {open && (bd || china) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700">Cancel sample…</summary>
              <ActionForm action={cancelAction} submitLabel="Cancel sample" variant="danger" confirm="Cancel this sample?" className="mt-2">
                {hid}
                <input name="reason" required placeholder="Reason" className={inputCls} />
              </ActionForm>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
