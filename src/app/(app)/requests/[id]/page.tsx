import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { A, Alert, Attachments, Badge, Card, Dl, Field, PageHeader, Table, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, fmtRmb, humanize } from "@/lib/format";
import { sum } from "@/lib/money";
import { can, canSeeSelling } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getOrderView } from "@/server/order-view";
import { isReleasedForPurchase } from "@/server/requests";
import { requestSampleAction } from "../../samples/actions";
import {
  cancelAction,
  commentAction,
  headerAction,
  holdAction,
  paymentAction,
  resumeAction,
  sendToChinaAction,
} from "../actions";

export default async function RequestPage({ params }: PageProps<"/requests/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const order = await getOrderView(id, user);
  if (!order) notFound();

  const showSelling = canSeeSelling(user);
  const canEdit = can(user.role, "request:edit");
  const editable = ["NEW", "SENT_TO_CHINA", "SAMPLING", "QUOTED"].includes(order.requestStatus);
  const closed = order.status === "CANCELLED" || order.status === "DELIVERED";
  const payments = "payments" in order ? order.payments : [];
  const released = isReleasedForPurchase({ requestStatus: order.requestStatus, payments });
  const advance = sum(payments.filter((p) => p.type === "ADVANCE").map((p) => p.amountBdt));
  const hidden = <input type="hidden" name="orderId" value={order.id} />;

  return (
    <>
      <PageHeader
        title={
          <>
            {docNo("order", order.number)} <span className="text-gray-400">·</span> {order.customer.name}
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={order.requestStatus} /> <Badge value={order.status} />
            {order.samples.map((smp) => (
              <A key={smp.id} href={`/samples/${smp.id}`}>
                {docNo("sample", smp.number)}
              </A>
            ))}{" "}
            {order.type === "BULK" ? "Bulk" : "Single"} · {humanize(order.shippingMethod)} · created by{" "}
            {order.createdBy.name}, {fmtDateTime(order.requestedAt, user.timezone)}
          </span>
        }
      />

      {order.requestStatus === "CUSTOMER_APPROVED" && !released && order.advanceRequestedAt && (
        <Alert tone="warn">
          China team requested an upfront payment on {fmtDateTime(order.advanceRequestedAt, user.timezone)}
          {order.advanceRequestNote && <> – “{order.advanceRequestNote}”</>}.{" "}
          {can(user.role, "payment:record") ? "Collect it from the customer and record it under Payments (type Advance) to confirm." : "Waiting for the BD team to confirm the payment."}
        </Alert>
      )}
      {order.requestStatus === "CUSTOMER_APPROVED" && !released && !order.advanceRequestedAt && order.status === "APPROVED" && (
        <Alert tone="info">In the China purchase queue – waiting for the China team to request the upfront payment.</Alert>
      )}
      {released && order.status === "APPROVED" && <Alert tone="ok">Upfront payment confirmed – the China team can purchase now.</Alert>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Products">
            <div className="space-y-4">
              {order.lines.map((l) => (
                <div key={l.id} className="rounded-md border border-gray-100 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {l.lineNo}. {l.productName} <span className="text-gray-500">× {l.quantity}</span>
                      </div>
                      <div className="text-xs text-gray-500">{[l.color, l.size, l.model].filter(Boolean).join(" · ") || "No variant"}</div>
                      {l.notes && <div className="mt-1 text-sm text-gray-600">{l.notes}</div>}
                    </div>
                    <Badge value={l.status} />
                  </div>
                  {l.links.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {l.links.map((lk) => (
                        <li key={lk.id} className="truncate">
                          <span className="mr-1 rounded bg-gray-100 px-1 text-gray-600">{humanize(lk.platform).replace("Alibaba 1688", "1688")}</span>
                          <a href={lk.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                            {lk.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Attachments items={l.attachments} />
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                    <span>Quoted: {fmtRmb(l.quotedUnitPriceRmb)} / pc</span>
                    {showSelling && "sellingPriceBdt" in l && <span>Selling (line): {fmtBdt(l.sellingPriceBdt as never)}</span>}
                    {l.purchaseLines.map((p) => (
                      <span key={p.id}>
                        Purchase <A href={`/purchasing/${p.supplierOrder.id}`}>{docNo("purchase", p.supplierOrder.number)}</A>: {fmtRmb(p.unitPriceRmb)} / pc
                        {p.priceApproval === "PENDING" && <Badge value="PRICE_CHANGED" label="Price approval needed" />}
                      </span>
                    ))}
                    {l.receivingLines.map((r) => (
                      <span key={r.id}>
                        Received {r.quantityReceived}/{r.quantityOrdered} in {docNo("receiving", r.receiving.number)}
                        {r.receiving.shipment && (
                          <>
                            {" "}
                            → <A href={`/shipments/${r.receiving.shipment.id}`}>{r.receiving.shipment.code}</A>
                          </>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="China quotation"
            actions={
              can(user.role, "estimate:edit") &&
              order.requestStatus === "SENT_TO_CHINA" &&
              !order.estimates.some((e) => ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"].includes(e.status)) && (
                <Link href={`/estimates/new?order=${order.id}`} className={btnPrimaryCls}>
                  {order.estimates[0]?.status === "DRAFT" ? "Continue quotation" : "Prepare quotation"}
                </Link>
              )
            }
          >
            {order.estimates.length === 0 ? (
              <p className="text-sm text-gray-500">
                {order.requestStatus === "NEW" ? "Send the request to China to get a quotation." : "Waiting for the China team to prepare the quotation."}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {order.estimates.map((e) => (
                  <li key={e.id}>
                    <A href={`/estimates/${e.id}`}>
                      {docNo("estimate", e.number)} v{e.version}
                    </A>{" "}
                    <Badge value={e.status} /> total {fmtRmb(e.totalRmb)}
                    {showSelling && "grandTotalBdt" in e && e.grandTotalBdt && <> · selling {fmtBdt(e.grandTotalBdt as never)}</>} · valid until {fmtDay(e.validUntil)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section id="samples">
            <Card title="Samples">
              {order.samples.length === 0 && <p className="mb-2 text-sm text-gray-500">No samples requested.</p>}
              <ul className="mb-3 space-y-1 text-sm">
                {order.samples.map((smp) => (
                  <li key={smp.id}>
                    <A href={`/samples/${smp.id}`}>{docNo("sample", smp.number)}</A> <Badge value={smp.status} />{" "}
                    {smp.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}
                  </li>
                ))}
              </ul>
              {canEdit && !closed && order.estimates.some((e) => e.status !== "DRAFT") && (
                <details>
                  <summary className="cursor-pointer text-sm text-blue-700">Request a sample…</summary>
                  <ActionForm action={requestSampleAction} submitLabel="Request sample" resetOnSuccess className="mt-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    {order.lines
                      .filter((l) => l.status !== "CANCELLED")
                      .map((l, i) => (
                        <div key={l.id} className="flex items-center gap-2 text-sm">
                          <input type="hidden" name={`x.${i}.orderLineId`} value={l.id} />
                          <input name={`x.${i}.quantity`} type="number" min={0} defaultValue={0} className={`${inputCls} w-20`} aria-label={`Sample qty for ${l.productName}`} />
                          <span>{l.productName}</span>
                        </div>
                      ))}
                    <input name="note" placeholder="Note for China (colour, size to check…)" className={inputCls} />
                  </ActionForm>
                </details>
              )}
            </Card>
          </section>

          <Card title="Comments">
            <div className="space-y-3">
              {order.comments.length === 0 && <p className="text-sm text-gray-400">No comments yet.</p>}
              {order.comments.map((c) => (
                <div key={c.id} className={`rounded-md p-2.5 text-sm ${c.author.role === "PURCHASE" ? "bg-amber-50" : "bg-blue-50"}`}>
                  <div className="text-xs text-gray-500">
                    <b className="text-gray-700">{c.author.name}</b> ({c.author.role === "PURCHASE" ? "China" : c.author.role === "CS" ? "Bangladesh" : "Admin"}) ·{" "}
                    {fmtDateTime(c.createdAt, user.timezone)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  <Attachments items={c.attachments} />
                </div>
              ))}
              <ActionForm action={commentAction} submitLabel="Post comment" resetOnSuccess>
                {hidden}
                <textarea name="body" rows={2} required placeholder="Write to the BD / China team…" className={inputCls} />
                <input type="file" name="files" multiple accept="image/*,application/pdf" className="text-sm" />
              </ActionForm>
            </div>
          </Card>

          <Card title="Timeline">
            <Timeline order={order} tz={user.timezone} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Customer">
            <Dl
              items={[
                ["Name", order.customer.name],
                ["Code", order.customer.code],
                ["Phone", order.customer.phone],
                ["Email", order.customer.email],
                ["Address", [order.customer.address, order.customer.area, order.customer.district].filter(Boolean).join(", ")],
              ]}
            />
          </Card>

          <Card title="Request details">
            <Dl
              items={[
                ["Target budget", fmtBdt(order.targetBudgetBdt)],
                ["Priority", order.priority],
                ["Type", `${humanize(order.type)}${order.typeOverridden ? " (set by CS)" : " (auto)"}`],
                ["Customer notes", order.customerNotes],
                ["Special instructions", order.specialInstructions],
              ]}
            />
            {canEdit && editable && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-blue-700">Edit</summary>
                <ActionForm action={headerAction} className="mt-2">
                  {hidden}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Type">
                      <select name="type" defaultValue={order.type} className={inputCls}>
                        <option value="SINGLE">Single</option>
                        <option value="BULK">Bulk</option>
                      </select>
                    </Field>
                    <Field label="Shipping">
                      <select name="shippingMethod" defaultValue={order.shippingMethod} className={inputCls}>
                        <option value="AIR">Air</option>
                        <option value="SEA">Sea</option>
                      </select>
                    </Field>
                    <Field label="Budget (BDT)">
                      <input name="targetBudgetBdt" defaultValue={order.targetBudgetBdt?.toString() ?? ""} className={inputCls} />
                    </Field>
                    <Field label="Priority">
                      <input name="priority" type="number" min={0} defaultValue={order.priority} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Customer notes">
                    <textarea name="customerNotes" defaultValue={order.customerNotes ?? ""} className={inputCls} />
                  </Field>
                  <Field label="Special instructions">
                    <textarea name="specialInstructions" defaultValue={order.specialInstructions ?? ""} className={inputCls} />
                  </Field>
                </ActionForm>
              </details>
            )}
          </Card>

          {!closed && (
            <Card title="Actions">
              <div className="flex flex-wrap gap-2">
                {canEdit && order.requestStatus === "NEW" && (
                  <ActionForm action={sendToChinaAction} submitLabel={order.type === "BULK" ? "Send to China for estimate" : "Send to China"}>
                    {hidden}
                  </ActionForm>
                )}
                {(canEdit || can(user.role, "purchase:edit")) &&
                  (order.status === "ON_HOLD" ? (
                    <ActionForm action={resumeAction} submitLabel="Resume" variant="default">
                      {hidden}
                    </ActionForm>
                  ) : (
                    <ActionForm action={holdAction} submitLabel="Put on hold" variant="default">
                      {hidden}
                    </ActionForm>
                  ))}
              </div>
              {canEdit && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-red-700">Cancel order…</summary>
                  <ActionForm action={cancelAction} submitLabel="Cancel order" variant="danger" confirm="Cancel this order?" className="mt-2">
                    {hidden}
                    <input name="reason" required placeholder="Reason" className={inputCls} />
                  </ActionForm>
                </details>
              )}
            </Card>
          )}

          {can(user.role, "price:viewSelling") && (
            <Card title="Payments">
              <Table head={["Date", "Type", "Amount", "Method"]} empty="No payments yet.">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className={tdCls}>{fmtDateTime(p.paidAt, user.timezone)}</td>
                    <td className={tdCls}>{humanize(p.type)}</td>
                    <td className={tdCls}>{fmtBdt(p.amountBdt)}</td>
                    <td className={tdCls}>
                      {humanize(p.method)}
                      {p.reference && <div className="text-xs text-gray-400">{p.reference}</div>}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="mt-2 text-sm">
                Advance received: <b>{fmtBdt(advance)}</b>
              </p>
              {can(user.role, "payment:record") && !closed && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-blue-700">Record payment</summary>
                  <ActionForm action={paymentAction} submitLabel="Record payment" resetOnSuccess className="mt-2">
                    {hidden}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Type">
                        <select name="type" className={inputCls}>
                          <option value="ADVANCE">Advance</option>
                          <option value="BALANCE">Balance</option>
                          <option value="REFUND">Refund</option>
                        </select>
                      </Field>
                      <Field label="Amount (BDT)">
                        <input name="amountBdt" required inputMode="decimal" className={inputCls} />
                      </Field>
                      <Field label="Method">
                        <select name="method" className={inputCls}>
                          {["BKASH", "NAGAD", "ROCKET", "CASH", "BANK_TRANSFER", "CARD", "OTHER"].map((m) => (
                            <option key={m} value={m}>
                              {humanize(m)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Reference">
                        <input name="reference" className={inputCls} />
                      </Field>
                    </div>
                    <Field label="Note">
                      <input name="note" className={inputCls} />
                    </Field>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Timeline({ order, tz }: { order: NonNullable<Awaited<ReturnType<typeof getOrderView>>>; tz: string }) {
  const events = order.lines
    .flatMap((l) => l.trackingEvents.map((e) => ({ ...e, line: l })))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (!events.length) return <p className="text-sm text-gray-400">No events yet.</p>;
  return (
    <ol className="space-y-2 border-l border-gray-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
          <div className="text-xs text-gray-500">
            {fmtDateTime(e.occurredAt, tz)} · {humanize(e.leg)} · line {e.line.lineNo} ({e.line.productName}){e.createdBy && <> · {e.createdBy.name}</>}
          </div>
          <div>
            {e.status && <Badge value={e.status} />} {e.message}
            {e.trackingNo && (
              <span className="text-gray-500">
                {" "}
                – {e.courier} {e.trackingNo}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
