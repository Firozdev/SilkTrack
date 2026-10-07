import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CartonRows } from "@/components/carton-rows";
import { A, Alert, Attachments, Badge, Card, Dl, Field, PageHeader, inputCls } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { fmtBdt, fmtCbm, fmtKg, fmtNum, fmtRate, humanize } from "@/lib/format";
import { can, canSeeSelling, redactFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { whatsappLink } from "@/lib/notify";
import { D, sum } from "@/lib/money";
import { acceptingShipments } from "@/server/shipments";
import { defaultShippingRates, shippingInvoiceMessage, shippingNo } from "@/server/shipping-orders";
import { SendInvoice } from "../../samples/[id]/send-invoice";
import { Step, Waiting } from "../../samples/[id]/step";
import { CustomerPanel } from "../../customer-panel";
import { estimateShipping } from "@/lib/shipping-estimate";
import { rateCardFor } from "@/server/shipping-rates";
import {
  assignAction,
  cancelAction,
  deliverAction,
  dispatchAction,
  holdAction,
  invoiceAction,
  invoiceSentAction,
  paymentAction,
  photoAction,
  qaAction,
  receiveBdAction,
  receiveChinaAction,
  trackingAction,
} from "../actions";

const CONDITIONS = [
  ["OK", "OK"],
  ["DAMAGED", "Damaged"],
  ["WRONG_ITEM", "Wrong item"],
  ["SHORT", "Short"],
] as const;
const METHODS = ["BKASH", "NAGAD", "ROCKET", "CASH", "BANK_TRANSFER", "CARD", "OTHER"];
const COURIERS = ["PATHAO", "STEADFAST", "REDX", "OWN_RIDER", "OTHER"];

export default async function ShippingOrderPage({ params }: PageProps<"/shipping-orders/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const raw = await prisma.shippingOrder.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, code: true, phone: true, email: true, address: true, district: true } },
      createdBy: { select: { name: true } },
      receivedChinaBy: { select: { name: true } },
      qaBy: { select: { name: true } },
      invoicedBy: { select: { name: true } },
      shipment: { select: { id: true, code: true, status: true, etaBd: true, cutoffDate: true } },
      items: { orderBy: { lineNo: "asc" }, include: { attachments: { select: { id: true, fileName: true, mimeType: true, uploadedByAccountId: true } } } },
      cartons: true,
      events: { orderBy: { occurredAt: "asc" }, include: { createdBy: { select: { name: true } } } },
      payments: { orderBy: { paidAt: "asc" } },
      attachments: { select: { id: true, fileName: true, mimeType: true, kind: true, uploadedByAccountId: true } },
    },
  });
  if (!raw) notFound();
  // PURCHASE never receives the customer charges or payments.
  const s = redactFor(user, raw);
  const showMoney = canSeeSelling(user);
  const china = can(user.role, "receiving:edit");
  const bd = can(user.role, "request:edit");
  const hid = <input type="hidden" name="id" value={s.id} />;
  const closed = s.status === "DELIVERED" || s.status === "CANCELLED";
  const held = s.status === "ON_HOLD";
  const active = !closed && !held;
  const st = s.status;

  const paid = showMoney ? sum(raw.payments.map((p) => (p.type === "REFUND" ? p.amountBdt.neg() : p.amountBdt))) : D(0);
  const balance = D(raw.invoiceTotalBdt).sub(paid);
  const air = s.shippingMethod === "AIR";
  const [shipments, rates] = await Promise.all([
    china && active && ["RECEIVED_CHINA", "QA_DONE", "IN_SHIPMENT"].includes(st) ? acceptingShipments(s.shippingMethod) : Promise.resolve([]),
    bd && active && ["RECEIVED_BD", "INVOICED"].includes(st) ? defaultShippingRates(s.shippingRateId) : Promise.resolve(null),
  ]);
  const est = showMoney && !raw.invoiceTotalBdt ? estimateShipping({ method: s.shippingMethod, weightKg: (s.grossWeightKg ?? s.declaredWeightKg)?.toString(), cbm: (s.cbm ?? s.declaredCbm)?.toString(), qa: s.qaRequested }, await rateCardFor(s.shippingRateId)) : null;
  const invoiceText = showMoney && raw.invoiceTotalBdt ? shippingInvoiceMessage(raw, s.customer.name, paid) : "";
  const str = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : v.toString());
  const qaPhotos = s.attachments.filter((a) => a.kind === "QA_PHOTO");
  const otherPhotos = s.attachments.filter((a) => a.kind !== "QA_PHOTO");

  return (
    <>
      <PageHeader
        title={`${shippingNo(s)} · Shipping service`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={s.status} /> <A href={`/customers/${s.customer.id}`}>{s.customer.name} ({s.customer.code})</A> · {humanize(s.shippingMethod)}
            {s.qaRequested && " · QA requested"} · {s.source === "PORTAL" ? "from customer portal" : `by ${s.createdBy?.name ?? "—"}`}, {fmtDateTime(s.createdAt, user.timezone)}
          </span>
        }
      />
      {s.status === "CANCELLED" && <Alert tone="error">This shipping order was cancelled – see the tracking below for the reason.</Alert>}
      {held && <Alert tone="warn">On hold – see the tracking below for the reason.</Alert>}
      {s.qaResult === "FAILED" && st === "QA_DONE" && <Alert tone="error">QA test failed. Tell the China team to ship anyway, or put the order on hold.</Alert>}
      {s.customerNotes && <Alert tone="info">Customer notes: {s.customerNotes}</Alert>}
      {showMoney && <CustomerPanel kind="shipping" id={s.id} tz={user.timezone} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="space-y-2">
            {/* 1. Request & supplier tracking */}
            <Step
              n={1}
              title="Products & supplier tracking"
              state={st === "REQUESTED" ? "current" : "done"}
              summary={`${s.items.length} item(s)${s.declaredWeightKg || s.declaredCbm ? ` · customer est. ${s.declaredWeightKg ? fmtKg(s.declaredWeightKg) : ""} ${s.declaredCbm ? fmtCbm(s.declaredCbm) : ""}` : ""}`}
            >
              {st === "REQUESTED" && (bd || china) ? (
                <ActionForm action={trackingAction} submitLabel="Save tracking">
                  {hid}
                  {s.items.map((i) => (
                    <div key={i.id} className="grid items-end gap-2 sm:grid-cols-6">
                      <input type="hidden" name={`t.${i.lineNo}.itemId`} value={i.id} />
                      <div className="text-sm sm:col-span-2">
                        <b>{i.productName}</b> × {i.quantity}
                        {i.description && <div className="text-xs text-gray-500">{i.description}</div>}
                        <Attachments items={i.attachments} />
                      </div>
                      <Field label="Courier (China)" className="sm:col-span-2">
                        <input name={`t.${i.lineNo}.courierName`} defaultValue={i.courierName ?? ""} className={inputCls} />
                      </Field>
                      <Field label="Tracking no." className="sm:col-span-2">
                        <input name={`t.${i.lineNo}.trackingNo`} defaultValue={i.trackingNo ?? ""} className={inputCls} />
                      </Field>
                    </div>
                  ))}
                </ActionForm>
              ) : (
                <ItemList items={s.items} />
              )}
            </Step>

            {/* 2. China warehouse receiving */}
            <Step
              n={2}
              title="Received at China warehouse"
              state={s.receivedChinaAt ? "done" : active && st === "REQUESTED" ? "current" : "todo"}
              summary={s.receivedChinaAt ? `${s.cartonCount} ctn · ${fmtKg(s.grossWeightKg)} · ${fmtCbm(s.cbm)}` : undefined}
            >
              {china && active && ["REQUESTED", "RECEIVED_CHINA", "QA_DONE"].includes(st) ? (
                <ActionForm action={receiveChinaAction} submitLabel={s.receivedChinaAt ? "Save corrections" : "Save receiving"}>
                  {hid}
                  {s.items.map((i) => (
                    <div key={i.id} className="grid items-end gap-2 border-b border-gray-50 pb-2 sm:grid-cols-6">
                      <input type="hidden" name={`i.${i.lineNo}.itemId`} value={i.id} />
                      <div className="text-sm sm:col-span-3">
                        <b>{i.productName}</b> × {i.quantity}
                        <div className="text-xs text-gray-500">{[i.courierName, i.trackingNo].filter(Boolean).join(" ") || "no tracking"}</div>
                      </div>
                      <Field label="Qty received">
                        <input name={`i.${i.lineNo}.quantityReceived`} type="number" min={0} defaultValue={i.quantityReceived ?? i.quantity} className={inputCls} />
                      </Field>
                      <Field label="Condition" className="sm:col-span-2">
                        <select name={`i.${i.lineNo}.condition`} defaultValue={i.condition ?? "OK"} className={inputCls}>
                          {CONDITIONS.map(([v, t]) => (
                            <option key={v} value={v}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  ))}
                  <CartonRows initial={s.cartons.map((c) => ({ l: c.lengthCm.toString(), w: c.widthCm.toString(), h: c.heightCm.toString(), kg: str(c.grossWeightKg) }))} />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label="Gross weight (kg)" hint="Blank = sum of carton weights">
                      <input name="grossWeightKg" inputMode="decimal" defaultValue={str(s.grossWeightKg)} className={inputCls} />
                    </Field>
                    <Field label="Carton mark">
                      <input name="cartonMark" defaultValue={s.cartonMark ?? s.customer.code} className={inputCls} />
                    </Field>
                    <Field label="Photos">
                      <input type="file" name="photos" accept="image/*" capture="environment" multiple className="text-sm" />
                    </Field>
                  </div>
                </ActionForm>
              ) : s.receivedChinaAt ? (
                <>
                  <ItemList items={s.items} received />
                  <p className="mt-2 text-xs text-gray-500">
                    {fmtDateTime(s.receivedChinaAt, user.timezone)} · {s.receivedChinaBy?.name} · mark {s.cartonMark ?? "—"} ·{" "}
                    {s.cartons.map((c) => `${fmtNum(c.lengthCm, 0)}×${fmtNum(c.widthCm, 0)}×${fmtNum(c.heightCm, 0)}`).join(", ")} cm
                  </p>
                </>
              ) : (
                <Waiting who="China" what="receive the goods" />
              )}
            </Step>

            {/* 3. QA (optional) */}
            <Step
              n={3}
              title="QA test"
              state={!s.qaRequested ? "skipped" : s.qaResult ? "done" : active && st === "RECEIVED_CHINA" ? "current" : "todo"}
              summary={!s.qaRequested ? "Not requested" : s.qaResult ? `${humanize(s.qaResult)}${s.qaNotes ? ` · ${s.qaNotes}` : ""}` : undefined}
            >
              {s.qaRequested && (
                <>
                  {qaPhotos.length > 0 && (
                    <div className="mb-2">
                      <Attachments items={qaPhotos} />
                    </div>
                  )}
                  {china && active && ["RECEIVED_CHINA", "QA_DONE"].includes(st) ? (
                    <ActionForm action={qaAction} submitLabel="Save QA result">
                      {hid}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Field label="Result *">
                          <select name="result" defaultValue={s.qaResult ?? "PASSED"} className={inputCls}>
                            <option value="PASSED">Passed</option>
                            <option value="FAILED">Failed</option>
                          </select>
                        </Field>
                        <Field label="Notes" className="sm:col-span-2">
                          <input name="notes" defaultValue={s.qaNotes ?? ""} className={inputCls} />
                        </Field>
                      </div>
                      <Field label="QA photos">
                        <input type="file" name="photos" accept="image/*" capture="environment" multiple className="text-sm" />
                      </Field>
                    </ActionForm>
                  ) : s.qaResult ? (
                    <p className="text-sm text-gray-600">
                      {humanize(s.qaResult)} · {s.qaBy?.name} · {fmtDateTime(s.qaAt, user.timezone)}
                    </p>
                  ) : (
                    <Waiting who="China" what="do the QA test" />
                  )}
                </>
              )}
            </Step>

            {/* 4. Weekly shipment */}
            <Step
              n={4}
              title="Weekly shipment"
              state={s.shipment ? "done" : active && (st === "QA_DONE" || (st === "RECEIVED_CHINA" && !s.qaRequested)) ? "current" : "todo"}
              summary={s.shipment ? `${s.shipment.code} · ${humanize(s.shipment.status)} · ETA ${fmtDay(s.shipment.etaBd)}` : undefined}
            >
              {can(user.role, "shipment:edit") && active && ["RECEIVED_CHINA", "QA_DONE", "IN_SHIPMENT"].includes(st) && (!s.qaRequested || s.qaResult) ? (
                <ActionForm action={assignAction} submitLabel={s.shipment ? "Move" : "Add to shipment"} inline>
                  {hid}
                  <select name="shipmentId" defaultValue={s.shipment?.id ?? "auto"} className={`${inputCls} max-w-md`} aria-label="Shipment">
                    {!s.shipment && <option value="auto">Suggested: current open {s.shippingMethod.toLowerCase()} shipment</option>}
                    {s.shipment && !shipments.some((x) => x.id === s.shipment!.id) && <option value={s.shipment.id}>{s.shipment.code}</option>}
                    {shipments.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · cut-off {fmtDay(x.cutoffDate)} · ETA {fmtDay(x.etaBd)}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              ) : s.shipment ? (
                <p className="text-sm text-gray-600">
                  In <A href={`/shipments/${s.shipment.id}`}>{s.shipment.code}</A> ({humanize(s.shipment.status)}).
                </p>
              ) : s.qaRequested && !s.qaResult && s.receivedChinaAt ? (
                <Waiting who="China" what="finish the QA test" />
              ) : (
                <Waiting who="China" what="add it to a shipment" />
              )}
            </Step>

            {/* 5. Received in Bangladesh */}
            <Step
              n={5}
              title="Received in Bangladesh"
              state={s.receivedBdAt ? "done" : active && st === "IN_SHIPMENT" ? "current" : "todo"}
              summary={s.receivedBdAt ? fmtDateTime(s.receivedBdAt, user.timezone) : st === "IN_SHIPMENT" ? `ETA ${fmtDay(s.shipment?.etaBd)}` : undefined}
            >
              {bd && active && st === "IN_SHIPMENT" ? (
                <ActionForm action={receiveBdAction} submitLabel="Received in Bangladesh">
                  {hid}
                </ActionForm>
              ) : s.receivedBdAt ? (
                <p className="text-sm text-gray-600">Received {fmtDateTime(s.receivedBdAt, user.timezone)}.</p>
              ) : (
                <Waiting who="Bangladesh" what="receive the goods" />
              )}
            </Step>

            {/* 6. Invoice (BD) */}
            <Step
              n={6}
              title="Invoice"
              state={s.invoicedAt && st !== "RECEIVED_BD" ? "done" : active && st === "RECEIVED_BD" ? "current" : "todo"}
              summary={showMoney && raw.invoiceTotalBdt ? `${fmtBdt(raw.invoiceTotalBdt)} · ${air ? `${fmtKg(raw.billWeightKg)} × ${fmtBdt(raw.shipRatePerKgBdt)}` : `${fmtCbm(raw.billCbm)} × ${fmtBdt(raw.shipRatePerCbmBdt)}`}` : undefined}
            >
              {bd && rates && active && ["RECEIVED_BD", "INVOICED"].includes(st) ? (
                <ActionForm action={invoiceAction} submitLabel={s.invoicedAt ? "Revise invoice" : "Save invoice"}>
                  {hid}
                  <p className="text-xs text-gray-500">
                    Billed on the China warehouse {air ? `weight (${fmtKg(s.grossWeightKg)})` : `CBM (${fmtCbm(s.cbm)})`}. Change it only if needed.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {air ? (
                      <Field label="Weight to bill (kg) *">
                        <input name="billWeightKg" required inputMode="decimal" defaultValue={str(raw.billWeightKg ?? s.grossWeightKg)} className={inputCls} />
                      </Field>
                    ) : (
                      <Field label="CBM to bill *">
                        <input name="billCbm" required inputMode="decimal" defaultValue={str(raw.billCbm ?? s.cbm)} className={inputCls} />
                      </Field>
                    )}
                    <Field label={`Rate ৳ per ${air ? "kg" : "CBM"} *`}>
                      <input name="ratePerUnitBdt" required inputMode="decimal" defaultValue={str(air ? raw.shipRatePerKgBdt : raw.shipRatePerCbmBdt) || (air ? rates.perKgBdt : rates.perCbmBdt)} className={inputCls} />
                    </Field>
                    <Field label="QA fee ৳">
                      <input name="qaFeeBdt" inputMode="decimal" defaultValue={str(raw.qaFeeBdt) || (s.qaRequested ? rates.qaFeeBdt : "")} className={inputCls} />
                    </Field>
                    <Field label="Home delivery ৳">
                      <input name="localDeliveryBdt" inputMode="decimal" defaultValue={raw.invoicedAt ? str(raw.localDeliveryBdt) : rates.localDeliveryBdt} className={inputCls} />
                    </Field>
                    <Field label="Other charges ৳">
                      <input name="otherChargeBdt" inputMode="decimal" defaultValue={str(raw.otherChargeBdt)} className={inputCls} />
                    </Field>
                    <Field label="Discount ৳">
                      <input name="discountBdt" inputMode="decimal" defaultValue={str(raw.discountBdt)} className={inputCls} />
                    </Field>
                  </div>
                </ActionForm>
              ) : s.invoicedAt ? (
                <p className="text-sm text-gray-600">{showMoney ? "Invoice details are on the right." : "Invoiced by the Bangladesh team."}</p>
              ) : (
                <Waiting who="Bangladesh" what="prepare the invoice" />
              )}
            </Step>

            {/* 7. Payment */}
            <Step
              n={7}
              title="Customer payment"
              state={s.invoicedAt && ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(st) ? "done" : active && st === "INVOICED" ? "current" : "todo"}
              summary={showMoney && raw.invoiceTotalBdt ? (balance.gt(0) ? `${fmtBdt(balance)} due${paid.gt(0) ? ` · paid ${fmtBdt(paid)}` : ""}` : `Fully paid ${fmtBdt(paid)}`) : undefined}
            >
              {showMoney && can(user.role, "payment:record") && active && st === "INVOICED" ? (
                <ActionForm action={paymentAction} submitLabel="Confirm payment received" inline resetOnSuccess>
                  {hid}
                  <input name="amountBdt" required defaultValue={balance.toString()} inputMode="decimal" className={`${inputCls} max-w-[9rem]`} aria-label="Amount BDT" />
                  <select name="method" className={`${inputCls} max-w-[9rem]`} aria-label="Method">
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {humanize(m)}
                      </option>
                    ))}
                  </select>
                  <input name="reference" placeholder="Reference" className={`${inputCls} max-w-[10rem]`} />
                </ActionForm>
              ) : st === "INVOICED" ? (
                <Waiting who="Bangladesh" what="collect the payment" />
              ) : showMoney && paid.gt(0) ? (
                <p className="text-sm text-gray-600">Payments received: {fmtBdt(paid)}.</p>
              ) : null}
            </Step>

            {/* 8. Delivery */}
            <Step
              n={8}
              title="Home delivery"
              state={s.deliveredAt ? "done" : active && ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(st) ? "current" : "todo"}
              summary={
                s.deliveredAt
                  ? `${fmtDateTime(s.deliveredAt, user.timezone)}${s.receiverName ? ` · ${s.receiverName}` : ""}`
                  : s.dispatchedAt
                    ? `Out with ${humanize(s.deliveryCourier ?? "OTHER")}${s.deliveryTrackingNo ? ` · ${s.deliveryTrackingNo}` : ""}`
                    : st === "READY_FOR_DELIVERY"
                      ? "Paid – ready for delivery"
                      : undefined
              }
            >
              {bd && active && st === "READY_FOR_DELIVERY" ? (
                <ActionForm action={dispatchAction} submitLabel="Out for delivery" inline>
                  {hid}
                  <p className="w-full text-xs text-gray-500">
                    {s.customer.address}
                    {s.customer.district ? `, ${s.customer.district}` : ""} · {s.customer.phone}
                  </p>
                  <select name="courier" className={`${inputCls} max-w-[10rem]`} aria-label="Courier">
                    {COURIERS.map((c) => (
                      <option key={c} value={c}>
                        {humanize(c)}
                      </option>
                    ))}
                  </select>
                  <input name="trackingNo" placeholder="Courier tracking no." className={`${inputCls} max-w-[12rem]`} />
                </ActionForm>
              ) : bd && active && st === "OUT_FOR_DELIVERY" ? (
                <ActionForm action={deliverAction} submitLabel="Delivered">
                  {hid}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Received by">
                      <input name="receiverName" className={inputCls} />
                    </Field>
                    <Field label="Proof of delivery (photo)">
                      <input type="file" name="photos" accept="image/*" capture="environment" multiple className="text-sm" />
                    </Field>
                  </div>
                </ActionForm>
              ) : s.deliveredAt ? (
                <p className="text-sm text-gray-600">Delivered {fmtDateTime(s.deliveredAt, user.timezone)}.</p>
              ) : (
                <Waiting who="Bangladesh" what="deliver the order" />
              )}
            </Step>
          </div>

          <Card title="Tracking">
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
          {showMoney && (
            <Card title="Invoice">
              {bd && raw.invoiceTotalBdt && (
                <div className="mb-3">
                  <SendInvoice
                    sampleId={s.id}
                    action={invoiceSentAction}
                    whatsappUrl={whatsappLink(s.customer.phone, invoiceText)}
                    mailtoUrl={s.customer.email ? `mailto:${s.customer.email}?subject=${encodeURIComponent(`Invoice ${shippingNo(s)}`)}&body=${encodeURIComponent(invoiceText)}` : null}
                  />
                </div>
              )}
              <Dl
                items={[
                  ["Billed on", raw.invoicedAt ? (air ? fmtKg(raw.billWeightKg) : fmtCbm(raw.billCbm)) : "—"],
                  ["Rate", raw.invoicedAt ? `${fmtBdt(air ? raw.shipRatePerKgBdt : raw.shipRatePerCbmBdt)} / ${air ? "kg" : "CBM"}` : "—"],
                  ["Shipping", fmtBdt(raw.shippingChargeBdt)],
                  ["QA fee", fmtBdt(raw.qaFeeBdt)],
                  ["Home delivery", fmtBdt(raw.localDeliveryBdt)],
                  ["Other", fmtBdt(raw.otherChargeBdt)],
                  ["Discount", raw.discountBdt ? `−${fmtBdt(raw.discountBdt)}` : "—"],
                  ["Total", <b key="t">{fmtBdt(raw.invoiceTotalBdt)}</b>],
                  ["Paid", fmtBdt(paid)],
                  ["Balance due", <b key="d" className={balance.gt(0) ? "text-red-700" : "text-green-700"}>{raw.invoiceTotalBdt ? fmtBdt(balance.isNeg() ? 0 : balance) : "—"}</b>],
                  ["RMB rate (saved)", fmtRate(raw.rateUsed)],
                  ["Invoiced", raw.invoicedAt ? `${fmtDateTime(raw.invoicedAt, user.timezone)} · ${raw.invoicedBy?.name ?? ""}` : "—"],
                ]}
              />
            </Card>
          )}
          <Card title="Size">
            <Dl
              items={[
                ["Customer estimate", s.declaredWeightKg || s.declaredCbm ? `${fmtKg(s.declaredWeightKg)} · ${fmtCbm(s.declaredCbm)}` : "—"],
                ["China warehouse", s.grossWeightKg ? `${s.cartonCount} ctn · ${fmtKg(s.grossWeightKg)} · ${fmtCbm(s.cbm)}` : "—"],
                ...(est ? ([["Estimate (rate card)", `≈ ${fmtBdt(est.total)} – ${s.grossWeightKg ? "measured" : "customer's"} size`]] as [string, string][]) : []),
                ["Shipment", s.shipment ? <A key="s" href={`/shipments/${s.shipment.id}`}>{s.shipment.code}</A> : "—"],
                ["Delivery", s.deliveryCourier ? `${humanize(s.deliveryCourier)}${s.deliveryTrackingNo ? ` · ${s.deliveryTrackingNo}` : ""}` : "—"],
              ]}
            />
          </Card>
          <Card title="Photos & files">
            <Attachments items={otherPhotos} />
            <ActionForm action={photoAction} submitLabel="Upload" inline className="mt-2" resetOnSuccess>
              {hid}
              <input type="file" name="photos" accept="image/*,application/pdf" capture="environment" multiple required className="text-sm" />
            </ActionForm>
          </Card>
          {bd && !closed && (
            <ActionForm action={holdAction} submitLabel={held ? "Release hold" : "Put on hold"} variant="default" inline>
              {hid}
              <input type="hidden" name="hold" value={held ? "no" : "yes"} />
              {!held && <input name="reason" placeholder="Reason" className={`${inputCls} max-w-xs`} />}
            </ActionForm>
          )}
          {bd && !closed && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700">Cancel shipping order…</summary>
              <ActionForm action={cancelAction} submitLabel="Cancel shipping order" variant="danger" confirm="Cancel this shipping order?" className="mt-2">
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

type ItemRow = {
  id: string;
  productName: string;
  description: string | null;
  quantity: number;
  courierName: string | null;
  trackingNo: string | null;
  quantityReceived: number | null;
  condition: string | null;
  attachments: { id: string; fileName: string; mimeType: string; uploadedByAccountId: string | null }[];
};

function ItemList({ items, received }: { items: ItemRow[]; received?: boolean }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((i) => (
        <li key={i.id}>
          {i.productName} {i.description && <span className="text-gray-500">{i.description}</span>} × <b>{i.quantity}</b>
          <span className="ml-2 text-xs text-gray-500">{[i.courierName, i.trackingNo].filter(Boolean).join(" ")}</span>
          {received && i.quantityReceived !== null && (
            <span className="ml-2">
              received {i.quantityReceived} {i.condition && <Badge value={i.condition} />}
            </span>
          )}
          <Attachments items={i.attachments} />
        </li>
      ))}
    </ul>
  );
}
