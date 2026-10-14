import { recordHistory } from "@/server/notifications";
import { NotificationHistory } from "@/components/notification-history";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Alert, Attachments, Card, Dl, Table, inputCls, tdCls } from "@/components/ui";
import { BD_TZ, fmtDateTime, fmtDay, today } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalOrder } from "@/server/portal";
import { ownerOf } from "@/server/portal-access";
import { portalQuoteAction } from "../../../actions";
import { fill } from "../../../i18n";
import { portalLabel } from "../../../labels";
import { getDict } from "../../../lang";
import { PStatus, Timeline } from "../../../portal-ui";
import { FilesCard } from "../../upload-box";
import { EditBar } from "../../edit-bar";
import { portalRequestEditable } from "@/lib/editability";
import { PaymentBox, ReceiptBox } from "../../payment-box";
import { amountDue } from "@/server/payment-submissions";

export default async function PortalRequestPage({ params }: PageProps<"/portal/requests/[id]">) {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  const { id } = await params;
  const cid = await ownerOf(acc, "order", id);
  const o = cid ? await portalOrder(cid, id) : null;
  if (!cid || !o) notFound();
  const history = await recordHistory({ orderId: o.id }, "customer");
  const due = await amountDue(cid, { kind: "order", id: o.id });
  const q = o.quote;
  const awaiting = q?.status === "SENT_TO_CUSTOMER";
  const expired = !!q && q.validUntil < today(BD_TZ);
  const files = o.attachments;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">
          {docNo("order", o.number)}
          {acc.kind === "AGENT" && <span className="mt-0.5 block text-sm font-normal text-gray-500">{fill(t.forCustomer, { name: o.customer.name, code: o.customer.code })}</span>}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <PStatus lang={lang} value={o.status === "REQUESTED" ? o.requestStatus : o.status} /> {portalLabel(o.shippingMethod, lang)} ·{" "}
          {fill(t.sentOn, { date: fmtDateTime(o.requestedAt, BD_TZ) })}
        </p>
      </div>
      {portalRequestEditable({ requestStatus: o.requestStatus, estimateCount: o._count.estimates }) && o.status !== "CANCELLED" && (
        <EditBar t={t} kind="order" id={o.id} editHref={`/portal/requests/${o.id}/edit`} />
      )}
      {awaiting && !expired && <Alert tone="warn">{fill(t.quoteReady, { total: fmtBdt(q.breakdown.estimatedTotal), date: fmtDay(q.validUntil) })}</Alert>}
      {awaiting && expired && <Alert tone="info">{t.quoteExpired}</Alert>}

      {q && (
        <Card title={`${t.quoteTitle} ${docNo("estimate", q.number)}${q.version > 1 ? ` (v${q.version})` : ""}`} actions={<PStatus lang={lang} value={q.status} />}>
          <Table head={[t.colProducts, t.qty.replace(" *", ""), t.unitPrice, t.amountCol]}>
            {q.breakdown.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdCls}>{l.productName}</td>
                <td className={tdCls}>{l.quantity}</td>
                <td className={`${tdCls} tabular-nums`}>{fmtBdt(l.unitPrice)}</td>
                <td className={`${tdCls} tabular-nums`}>{fmtBdt(l.amount)}</td>
              </tr>
            ))}
          </Table>
          <dl className="ml-auto mt-3 max-w-md space-y-1 text-sm">
            <div className="flex justify-between gap-4 font-medium">
              <dt>{t.totalPurchase}</dt>
              <dd className="tabular-nums">{fmtBdt(q.breakdown.products)}</dd>
            </div>
            {q.breakdown.shipping ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt>
                    {fill(t.estShipQuote, {
                      method: portalLabel(q.shippingMethod, lang),
                      basis: q.breakdown.shipping.unit === "kg" ? fmtKg(q.breakdown.shipping.basis) : fmtCbm(q.breakdown.shipping.basis),
                      rate: `${fmtBdt(q.breakdown.shipping.rate)}${q.breakdown.shipping.unit === "kg" ? t.perKg : t.perCbm}`,
                    })}
                  </dt>
                  <dd className="tabular-nums">{fmtBdt(q.breakdown.shipping.amount)}</dd>
                </div>
                {q.breakdown.delivery.gt(0) && (
                  <div className="flex justify-between gap-4">
                    <dt>{t.estDelivery}</dt>
                    <dd className="tabular-nums">{fmtBdt(q.breakdown.delivery)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t border-gray-200 pt-1 text-base font-semibold">
                  <dt>{t.estTotalQuote}</dt>
                  <dd className="tabular-nums">≈ {fmtBdt(q.breakdown.estimatedTotal)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            ⚠ {q.breakdown.shipping ? t.shipNote : t.shipLater} {t.advanceNote}
          </p>
          <p className="mt-2 text-xs text-gray-500">{fill(t.validUntil, { date: fmtDay(q.validUntil) })}</p>
          {awaiting && !expired && q.estimateId && (
            <div className="mt-3 flex flex-wrap items-start gap-4 border-t border-gray-100 pt-3">
              <ActionForm action={portalQuoteAction} submitLabel={t.approveQuote} confirm={t.approveConfirm} inline>
                <input type="hidden" name="estimateId" value={q.estimateId} />
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="decision" value="APPROVE" />
              </ActionForm>
              <ActionForm action={portalQuoteAction} submitLabel={t.declineQuote} variant="danger" confirm={t.declineConfirm} inline>
                <input type="hidden" name="estimateId" value={q.estimateId} />
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="decision" value="DECLINE" />
                <input name="reason" placeholder={t.declineReason} className={`${inputCls} max-w-xs`} />
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      {o.lines.map((l) => (
        <Card key={l.id} title={`${l.productName} × ${l.quantity}`} actions={<PStatus lang={lang} value={l.status} />}>
          <p className="mb-2 text-sm text-gray-500">
            {[l.color, l.size, l.model].filter(Boolean).join(" · ")}
            {l.links.map((x) => (
              <a key={x.url} href={x.url} target="_blank" rel="noreferrer noopener" className="ml-2 text-blue-700 hover:underline">
                {t.link} ↗
              </a>
            ))}
          </p>
          {l.attachments.length > 0 && (
            <div className="mb-3">
              <Attachments items={l.attachments} base="/portal/files" customerTag={null} />
            </div>
          )}
          <Timeline
            tz={BD_TZ}
            lang={lang}
            events={l.trackingEvents.map((e) => ({
              id: e.id,
              status: e.status,
              occurredAt: e.occurredAt,
              note: <span className="text-gray-500">{[e.shipment?.code, e.courier, e.trackingNo].filter(Boolean).join(" · ")}</span>,
            }))}
          />
        </Card>
      ))}

      <PaymentBox t={t} lang={lang} kind="order" id={o.id} due={due?.due ?? null} submissions={o.paymentSubmissions} />
      <ReceiptBox
        t={t}
        kind="order"
        id={o.id}
        canConfirm={["OUT_FOR_DELIVERY", "DELIVERED"].includes(o.status)}
        confirmedAt={o.customerConfirmedAt}
        note={o.customerNote}
        problem={o.customerReportedProblem}
      />
      <FilesCard t={t} files={files} kind="order" id={o.id} canUpload={!["CANCELLED", "DELIVERED"].includes(o.status)} />

      {(o.invoices.length > 0 || o.payments.length > 0) && (
        <Card title={t.billsPayments}>
          {o.invoices.map((inv) => (
            <Dl
              key={inv.id}
              items={[
                [`${t.invoice} ${docNo("invoice", inv.number)}`, <PStatus key="s" lang={lang} value={inv.status} />],
                [t.total, fmtBdt(inv.totalBdt)],
                [t.advancePaid, fmtBdt(inv.advancePaidBdt)],
                [t.balanceDue, <b key="b">{fmtBdt(inv.balanceDueBdt)}</b>],
              ]}
            />
          ))}
          <ul className="mt-3 space-y-1 text-sm">
            {o.payments.map((p) => (
              <li key={p.id}>
                {fmtDateTime(p.paidAt, BD_TZ)} · {portalLabel(p.type, lang)} · <b>{fmtBdt(p.amountBdt)}</b> ({portalLabel(p.method, lang)})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">{fill(t.paidTotal, { amount: fmtBdt(o.paid) })}</p>
        </Card>
      )}

      {o.deliveries.length > 0 && (
        <Card title={t.delivery}>
          {o.deliveries.map((d) => (
            <p key={d.id} className="text-sm">
              <PStatus lang={lang} value={d.status} /> {portalLabel(d.courier, lang)} {d.trackingNo && `· ${d.trackingNo}`}{" "}
              {d.deliveredAt && `· ${fill(t.deliveredOn, { date: fmtDateTime(d.deliveredAt, BD_TZ) })}`}
            </p>
          ))}
        </Card>
      )}

      {o.samples.length > 0 && (
        <Card title={t.samples}>
          {o.samples.map((s) => (
            <p key={s.id} className="text-sm">
              <A href={`/portal/samples/${s.id}`}>{docNo("sample", s.number)}</A> <PStatus lang={lang} value={s.status} />
            </p>
          ))}
        </Card>
      )}
      <NotificationHistory title={t.updatesTitle} empty={t.noUpdates} items={history} fmt={(d) => fmtDateTime(d, BD_TZ)} />
    </div>
  );
}
