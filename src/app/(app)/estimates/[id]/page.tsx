import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Alert, Badge, Card, Dl, Field, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { rmbToBdt, sum } from "@/lib/money";
import { BD_TZ, fmtDateTime, fmtDay, today } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg, fmtNum, fmtRate, fmtRmb, humanize } from "@/lib/format";
import { can, canSeeSelling, redactFor } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getQuotation } from "@/server/estimates";
import { approveAction, rejectAction, reviseAction, sellingAction, sendAction, submitAction } from "../actions";

export default async function QuotationPage({ params }: PageProps<"/estimates/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const raw = await getQuotation(id);
  if (!raw) notFound();
  const e = redactFor(user, raw);
  const isChina = can(user.role, "estimate:edit");
  const isBd = can(user.role, "quote:edit");
  const selling = canSeeSelling(user);
  const showMargin = can(user.role, "price:viewSelling");
  const expired = e.validUntil < today(BD_TZ);
  const hid = <input type="hidden" name="id" value={e.id} />;
  const sellingEditable = selling && ["DRAFT", "SUBMITTED_BY_CHINA", "REVIEWED_BY_BD"].includes(e.status);
  const revisable = ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"].includes(e.status) && !e.nextVersion && (isChina || isBd);

  return (
    <>
      <PageHeader
        title={`${docNo("estimate", e.number)} v${e.version} · ${docNo("order", e.order.number)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={e.status} /> {e.order.customer.name} ({e.order.customer.code}) · by {e.createdBy.name} · valid until {fmtDay(e.validUntil)}
            {expired && <Badge value="FAILED" label="Expired" />}
          </span>
        }
        actions={
          <>
            <Link href={`/requests/${e.order.id}`} className={btnCls}>
              Request
            </Link>
            {selling && e.grandTotalBdt && (
              <Link href={`/estimates/${e.id}/quote`} className={btnCls} target="_blank">
                🖨 Customer quote (PDF)
              </Link>
            )}
          </>
        }
      />
      {e.nextVersion && (
        <Alert tone="info">
          Replaced by <A href={`/estimates/${e.nextVersion.id}`}>version {e.nextVersion.version}</A>.
        </Alert>
      )}
      {expired && ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"].includes(e.status) && <Alert tone="warn">This quotation has expired. Revise it to re-price at today&apos;s rate before the customer approves.</Alert>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Products">
            <Table head={["Product", "Qty", "Unit ¥", "Total ¥", "Weight", "Cartons · L×W×H", "CBM", ...(selling ? ["Selling ৳"] : [])]}>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td className={tdCls}>
                    {l.orderLine?.lineNo}. {l.productName}
                    <div className="text-xs text-gray-400">
                      {[l.orderLine?.color, l.orderLine?.size, l.orderLine?.model].filter(Boolean).join(" · ")}
                      {l.moq ? ` · MOQ ${l.moq}` : ""}
                    </div>
                  </td>
                  <td className={tdCls}>{l.quantity}</td>
                  <td className={`${tdCls} tabular-nums`}>{fmtRmb(l.unitPriceRmb)}</td>
                  <td className={`${tdCls} tabular-nums`}>{fmtRmb(l.lineTotalRmb)}</td>
                  <td className={tdCls}>
                    {fmtKg(l.weightKg)}
                    {l.unitWeightKg && <div className="text-xs text-gray-400">{fmtNum(l.unitWeightKg, 3)} kg/pc</div>}
                  </td>
                  <td className={tdCls}>
                    {l.cartonCount} {l.lengthCm && `· ${fmtNum(l.lengthCm, 1)}×${fmtNum(l.widthCm, 1)}×${fmtNum(l.heightCm, 1)}`}
                  </td>
                  <td className={tdCls}>{fmtCbm(l.cbm)}</td>
                  {selling && <td className={`${tdCls} tabular-nums`}>{"sellingPriceBdt" in l ? fmtBdt(l.sellingPriceBdt as never) : "—"}</td>}
                </tr>
              ))}
            </Table>
          </Card>

          {sellingEditable && (
            <Card title="Selling price for the customer (BDT, per line)">
              <ActionForm action={sellingAction} submitLabel="Save selling prices">
                {hid}
                {e.lines.map((l, i) => (
                  <div key={l.id} className="grid items-end gap-2 sm:grid-cols-3">
                    <input type="hidden" name={`s.${i}.lineId`} value={l.id} />
                    <div className="text-sm sm:col-span-2">
                      {l.productName} × {l.quantity}
                      <div className="text-xs text-gray-400">
                        Product cost {fmtRmb(l.lineTotalRmb)} ≈ {fmtBdt(rmbToBdt(l.lineTotalRmb, e.rateUsed))}, before China costs and shipping
                      </div>
                    </div>
                    <Field label="Selling ৳ (line total)">
                      <input name={`s.${i}.sellingPriceBdt`} defaultValue={"sellingPriceBdt" in l && l.sellingPriceBdt ? String(l.sellingPriceBdt) : ""} required inputMode="decimal" className={inputCls} />
                    </Field>
                  </div>
                ))}
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Totals">
            <Dl
              items={[
                ["Products", fmtRmb(e.rmbSubtotal)],
                ["Domestic shipping", fmtRmb(e.domesticShippingRmb)],
                ["Packing / QC / service", fmtRmb(sum([e.packingRmb, e.inspectionRmb, e.serviceFeeRmb]))],
                ["Weight · CBM", `${fmtKg(e.grossWeightKg)} · ${fmtCbm(e.cbm)} · ${e.cartonCount} ctn`],
                [
                  `Shipping (${humanize(e.shippingMethod)})`,
                  `${fmtRmb(e.shippingRmb)}${e.shippingMethod === "AIR" ? ` @ ¥${fmtNum(e.shippingRatePerKgRmb)}/kg` : ` @ ¥${fmtNum(e.shippingRatePerCbmRmb)}/m³`}`,
                ],
                ["Total order price", <b key="t">{fmtRmb(e.totalRmb)}</b>],
                ["Rate (locked)", `${fmtRate(e.rateUsed)} · ${fmtDay(e.exchangeRate.effectiveDate)}`],
                ["Total in BDT", fmtBdt(e.totalBdt)],
                ...(selling ? ([["Selling total", <b key="g">{fmtBdt(e.grandTotalBdt as never)}</b>]] as [string, React.ReactNode][]) : []),
                ...(showMargin ? ([["Margin", fmtBdt(e.marginBdt as never)]] as [string, React.ReactNode][]) : []),
              ]}
            />
            {e.notes && <p className="mt-3 whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">{e.notes}</p>}
          </Card>

          <Card title="Actions">
            <div className="flex flex-wrap gap-2">
              {isChina && e.status === "DRAFT" && (
                <>
                  <Link href={`/estimates/new?order=${e.order.id}`} className={btnCls}>
                    Edit
                  </Link>
                  <ActionForm action={submitAction} submitLabel="Submit to Bangladesh">
                    {hid}
                  </ActionForm>
                </>
              )}
              {isBd && ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD"].includes(e.status) && (
                <ActionForm action={sendAction} submitLabel="Send to customer">
                  {hid}
                </ActionForm>
              )}
              {isBd && e.status === "SENT_TO_CUSTOMER" && (
                <>
                  <ActionForm action={approveAction} submitLabel="Customer approved">
                    {hid}
                  </ActionForm>
                  <ActionForm action={rejectAction} submitLabel="Customer rejected" variant="default" confirm="Mark as rejected? The request will be closed.">
                    {hid}
                  </ActionForm>
                </>
              )}
              {isBd && ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD", "SENT_TO_CUSTOMER"].includes(e.status) && (
                <Link href={`/requests/${e.order.id}#samples`} className={btnCls}>
                  Request sample
                </Link>
              )}
            </div>
            {revisable && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-blue-700">Revise (new version, re-priced at today&apos;s rate)…</summary>
                <ActionForm action={reviseAction} submitLabel="Create new version" variant="default" className="mt-2">
                  {hid}
                  <input name="reason" placeholder="What should change?" className={inputCls} />
                </ActionForm>
              </details>
            )}
            {e.status === "APPROVED" && <p className="text-sm text-green-700">Approved – the order is in the China purchase queue.</p>}
          </Card>

          <Card title="History">
            <Dl
              items={[
                ["Created", fmtDateTime(e.createdAt, user.timezone)],
                ["Submitted", fmtDateTime(e.submittedAt, user.timezone)],
                ["Reviewed", e.reviewedAt ? `${fmtDateTime(e.reviewedAt, user.timezone)} · ${e.reviewedBy?.name ?? ""}` : "—"],
                ["Sent to customer", fmtDateTime(e.sentAt, user.timezone)],
                ["Decided", fmtDateTime(e.decidedAt, user.timezone)],
                ["Previous version", e.previousVersion ? <A key="p" href={`/estimates/${e.previousVersion.id}`}>v{e.previousVersion.version}</A> : "—"],
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
