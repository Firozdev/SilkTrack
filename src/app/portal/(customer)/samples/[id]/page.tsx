import { notFound } from "next/navigation";
import { A, Attachments, Card, Dl } from "@/components/ui";
import { BD_TZ, fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalSample } from "@/server/portal";
import { amountDue } from "@/server/payment-submissions";
import { fill } from "../../../i18n";
import { portalLabel } from "../../../labels";
import { getDict } from "../../../lang";
import { PStatus, Timeline } from "../../../portal-ui";
import { PaymentBox, ReceiptBox } from "../../payment-box";

export default async function PortalSamplePage({ params }: PageProps<"/portal/samples/[id]">) {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  const { id } = await params;
  const s = await portalSample(acc.customer.id, id);
  if (!s) notFound();
  const due = await amountDue(acc.customer.id, { kind: "sample", id: s.id });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{fill(t.sampleTitle, { no: docNo("sample", s.number) })}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <PStatus lang={lang} value={s.status} /> {fill(t.requestedOn, { date: fmtDateTime(s.requestedAt, BD_TZ) })}
          {s.order && (
            <>
              · {t.forOrder} <A href={`/portal/requests/${s.order.id}`}>{docNo("order", s.order.number)}</A>
            </>
          )}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={t.products}>
            <ul className="space-y-1 text-sm">
              {s.lines.map((l) => (
                <li key={l.id}>
                  {l.productName} {l.variant && <span className="text-gray-500">{l.variant}</span>} × <b>{l.quantity}</b>
                  <Attachments items={l.attachments} base="/portal/files" customerTag={null} />
                </li>
              ))}
            </ul>
            <Attachments items={s.attachments} base="/portal/files" customerTag={null} />
          </Card>
          <Card title={t.tracking}>
            <Timeline tz={BD_TZ} lang={lang} events={s.events} />
          </Card>
          <ReceiptBox t={t} kind="sample" id={s.id} canConfirm={s.status === "DELIVERED"} confirmedAt={s.customerConfirmedAt} note={s.customerNote} problem={s.customerReportedProblem} />
        </div>
        <div className="space-y-5">
          <PaymentBox t={t} lang={lang} kind="sample" id={s.id} due={due?.due ?? null} submissions={s.paymentSubmissions} />
          <Card title={t.billShipping}>
            <Dl
              items={[
                [t.sampleBill, fmtBdt(s.totalBdt)],
                [t.paid, fmtBdt(s.paid)],
                [t.balanceDue, <b key="b">{s.totalBdt ? fmtBdt(s.balance) : "—"}</b>],
                [t.sentBy, s.shipment ? `${t.shipment} ${s.shipment.code}` : s.shippingMode ? portalLabel(s.shippingMode, lang) : "—"],
                [
                  t.tracking,
                  s.trackingUrl ? (
                    <a key="t" href={s.trackingUrl} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline">
                      {s.trackingNo ?? "↗"}
                    </a>
                  ) : (
                    (s.trackingNo ?? "—")
                  ),
                ],
                [t.expectedBd, fmtDay(s.etaBd)],
                [t.delivered, s.deliveredAt ? fmtDateTime(s.deliveredAt, BD_TZ) : "—"],
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
