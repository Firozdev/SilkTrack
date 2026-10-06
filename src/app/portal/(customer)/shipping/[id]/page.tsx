import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Alert, Attachments, Card, Dl, Field, inputCls } from "@/components/ui";
import { BD_TZ, fmtDateTime, fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalShippingOrder } from "@/server/portal";
import { portalTrackingAction } from "../../../actions";
import { fill } from "../../../i18n";
import { portalLabel } from "../../../labels";
import { getDict } from "../../../lang";
import { PStatus, Timeline } from "../../../portal-ui";
import { FilesCard } from "../../upload-box";
import { EditBar } from "../../edit-bar";
import { EstimateBox } from "../../estimate-box";
import { rateCard } from "@/server/settings";
import { portalShippingEditable } from "@/lib/editability";
import { PaymentBox, ReceiptBox } from "../../payment-box";
import { amountDue } from "@/server/payment-submissions";

export default async function PortalShippingPage({ params }: PageProps<"/portal/shipping/[id]">) {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  const { id } = await params;
  const s = await portalShippingOrder(acc.customer.id, id);
  if (!s) notFound();
  const [due, rates] = await Promise.all([amountDue(acc.customer.id, { kind: "shipping", id: s.id }), rateCard()]);
  const air = s.shippingMethod === "AIR";
  const money = (label: string, v: { gt(n: number): boolean } | null, text: string): [string, string][] => (v?.gt(0) ? [[label, text]] : []);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{docNo("shippingOrder", s.number)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <PStatus lang={lang} value={s.status} /> {portalLabel(s.shippingMethod, lang)} · {fill(t.sentOn, { date: fmtDateTime(s.createdAt, BD_TZ) })}
        </p>
      </div>
      {s.status === "REQUESTED" && <Alert tone="info">{fill(t.parcelHint, { code: acc.customer.code })}</Alert>}
      {portalShippingEditable(s) && <EditBar t={t} kind="shipping" id={s.id} editHref={`/portal/shipping/${s.id}/edit`} />}
      {s.status === "INVOICED" && s.balance.gt(0) && <Alert tone="warn">{fill(t.invoiceReady, { amount: fmtBdt(s.balance) })}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={t.products}>
            {s.status === "REQUESTED" ? (
              <ActionForm action={portalTrackingAction} submitLabel={t.saveTracking}>
                <input type="hidden" name="id" value={s.id} />
                {s.items.map((i) => (
                  <div key={i.id} className="grid items-end gap-2 sm:grid-cols-6">
                    <input type="hidden" name={`t.${i.lineNo}.itemId`} value={i.id} />
                    <div className="text-sm sm:col-span-2">
                      <b>{i.productName}</b> × {i.quantity}
                      {i.description && <div className="text-xs text-gray-500">{i.description}</div>}
                      <Attachments items={i.attachments} base="/portal/files" customerTag={null} />
                    </div>
                    <Field label={t.chinaCourier} className="sm:col-span-2">
                      <input name={`t.${i.lineNo}.courierName`} defaultValue={i.courierName ?? ""} className={inputCls} />
                    </Field>
                    <Field label={t.trackingNo} className="sm:col-span-2">
                      <input name={`t.${i.lineNo}.trackingNo`} defaultValue={i.trackingNo ?? ""} className={inputCls} />
                    </Field>
                  </div>
                ))}
              </ActionForm>
            ) : (
              <ul className="space-y-1 text-sm">
                {s.items.map((i) => (
                  <li key={i.id}>
                    {i.productName} × <b>{i.quantity}</b>
                    {i.quantityReceived !== null && (
                      <span className="ml-2 text-gray-500">
                        {fill(t.received, { n: i.quantityReceived })}
                        {i.condition && i.condition !== "OK" ? ` (${portalLabel(i.condition, lang)})` : ""}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">{[i.courierName, i.trackingNo].filter(Boolean).join(" ")}</span>
                    <Attachments items={i.attachments} base="/portal/files" customerTag={null} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t.tracking}>
            <Timeline tz={BD_TZ} lang={lang} events={s.events} />
          </Card>
          <ReceiptBox
            t={t}
            kind="shipping"
            id={s.id}
            canConfirm={["OUT_FOR_DELIVERY", "DELIVERED"].includes(s.status)}
            confirmedAt={s.customerConfirmedAt}
            note={s.customerNote}
            problem={s.customerReportedProblem}
          />
          <FilesCard t={t} files={s.attachments} kind="shipping" id={s.id} canUpload={!["DELIVERED", "CANCELLED"].includes(s.status)} />
        </div>
        <div className="space-y-5">
          <Card title={t.sizeShipping}>
            <Dl
              items={[
                [t.measured, s.grossWeightKg ? `${s.cartonCount} ${t.cartons} · ${fmtKg(s.grossWeightKg)} · ${fmtCbm(s.cbm)}` : t.notReceived],
                [t.qualityCheck, s.qaRequested ? (s.qaResult ? `${s.qaResult === "PASSED" ? t.passed : t.failed}${s.qaNotes ? ` – ${s.qaNotes}` : ""}` : t.requested) : t.notRequested],
                [t.shipment, s.shipment ? `${s.shipment.code} · ${portalLabel(s.shipment.status, lang)}` : "—"],
                [t.expectedBd, s.receivedBdAt ? fill(t.arrivedOn, { date: fmtDay(s.receivedBdAt) }) : s.shipment ? fmtDay(s.shipment.etaBd) : "—"],
                [t.delivery, s.deliveryCourier ? `${portalLabel(s.deliveryCourier, lang)}${s.deliveryTrackingNo ? ` · ${s.deliveryTrackingNo}` : ""}` : "—"],
              ]}
            />
          </Card>
          {!s.invoiceTotalBdt && s.status !== "CANCELLED" && (
            <EstimateBox
              t={t}
              rates={rates}
              method={s.shippingMethod}
              weightKg={(s.grossWeightKg ?? s.declaredWeightKg)?.toString()}
              cbm={(s.cbm ?? s.declaredCbm)?.toString()}
              qa={s.qaRequested}
              measured={!!s.grossWeightKg}
            />
          )}
          <PaymentBox t={t} lang={lang} kind="shipping" id={s.id} due={due?.due ?? null} submissions={s.paymentSubmissions} />
          {s.invoiceTotalBdt && (
            <Card title={t.invoice}>
              <Dl
                items={[
                  [`${t.shippingCharge} (${air ? `${fmtKg(s.billWeightKg)} × ${fmtBdt(s.shipRatePerKgBdt)}` : `${fmtCbm(s.billCbm)} × ${fmtBdt(s.shipRatePerCbmBdt)}`})`, fmtBdt(s.shippingChargeBdt)],
                  ...money(t.qualityCheck, s.qaFeeBdt, fmtBdt(s.qaFeeBdt)),
                  ...money(t.homeDelivery, s.localDeliveryBdt, fmtBdt(s.localDeliveryBdt)),
                  ...money(t.other, s.otherChargeBdt, fmtBdt(s.otherChargeBdt)),
                  ...money(t.discount, s.discountBdt, `−${fmtBdt(s.discountBdt)}`),
                  [t.total, <b key="t">{fmtBdt(s.invoiceTotalBdt)}</b>],
                  [t.paid, fmtBdt(s.paid)],
                  [t.balanceDue, <b key="b" className={s.balance.gt(0) ? "text-red-700" : "text-green-700"}>{fmtBdt(s.balance)}</b>],
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
