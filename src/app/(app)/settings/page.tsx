import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, PageHeader, Table, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { fmtBdt } from "@/lib/format";
import { estimateShipping } from "@/lib/shipping-estimate";
import { requirePagePermission } from "@/lib/session";
import { allSettings } from "@/server/settings";
import { listShippingRates, rateCardOf } from "@/server/shipping-rates";
import { addRateAction, deleteRateAction, saveOrderRulesAction } from "./actions";

const STATUS_BADGE = { LIVE: ["COMPLETED", "Live"], UPCOMING: ["UPCOMING", "Upcoming"], PREVIOUS: ["CLOSED_OLD", "Previous"] } as const;

export default async function SettingsPage() {
  const user = await requirePagePermission("settings:manage");
  const [{ values: v, lastUpdated }, rates] = await Promise.all([allSettings(), listShippingRates()]);
  const live = rates.find((r) => r.status === "LIVE") ?? null;
  const card = await rateCardOf(live);
  const airEx = estimateShipping({ method: "AIR", weightKg: 10 }, card);
  const seaEx = estimateShipping({ method: "SEA", cbm: 1 }, card);
  const tz = user.timezone;
  const money = (d: { toString(): string } | null) => (d ? fmtBdt(d.toString()) : "—");

  return (
    <>
      <PageHeader title="Settings" subtitle="Only Admin can change these. Every change is in the audit log." />

      <Card title="Shipping charges (BDT)" className="mb-5">
        <p className="mb-3 text-sm text-gray-600">
          Customers see the <b>live</b> rate as an estimated cost when they place a shipping order. Each order keeps the rate that was live when it was placed; its invoice is prefilled
          with it. Rates are never edited – add a new one (now or from a future date) and the old one moves to <i>Previous</i>.
        </p>
        {live ? (
          <Alert tone="ok">
            Live since {fmtDateTime(live.effectiveFrom, tz)}: Air {money(live.airPerKgBdt)}/kg · Sea {money(live.seaPerCbmBdt)}/CBM · QA {money(live.qaFeeBdt)} · Home delivery{" "}
            {money(live.localDeliveryBdt)}.{" "}
            {(airEx || seaEx) && (
              <>
                Customer sees e.g. {airEx && <>10 kg by air ≈ <b>{fmtBdt(airEx.total)}</b></>}
                {airEx && seaEx && " · "}
                {seaEx && <>1 CBM by sea ≈ <b>{fmtBdt(seaEx.total)}</b></>}.
              </>
            )}
          </Alert>
        ) : (
          <Alert tone="warn">No shipping rate yet – customers don&apos;t see an estimate. Add the first rate below.</Alert>
        )}

        <div className="mt-4">
          <Table head={["Status", "Starts", "Ends", "Air /kg", "Sea /CBM", "QA fee", "Delivery", "Orders", "Added by", ""]} empty="No rates yet.">
            {rates.map((r) => (
              <tr key={r.id} className={r.status === "LIVE" ? "bg-green-50/60" : ""}>
                <td className={tdCls}>
                  <Badge value={STATUS_BADGE[r.status][0]} label={STATUS_BADGE[r.status][1]} />
                </td>
                <td className={tdCls}>{fmtDateTime(r.effectiveFrom, tz)}</td>
                <td className={tdCls}>{r.endsAt ? fmtDateTime(r.endsAt, tz) : "—"}</td>
                <td className={tdCls}>{money(r.airPerKgBdt)}</td>
                <td className={tdCls}>{money(r.seaPerCbmBdt)}</td>
                <td className={tdCls}>{money(r.qaFeeBdt)}</td>
                <td className={tdCls}>{money(r.localDeliveryBdt)}</td>
                <td className={tdCls}>{r._count.shippingOrders}</td>
                <td className={tdCls}>
                  {r.createdBy?.name ?? "—"}
                  {r.note && <div className="text-xs text-gray-500">{r.note}</div>}
                </td>
                <td className={tdCls}>
                  {r.status === "UPCOMING" && (
                    <ActionForm action={deleteRateAction} submitLabel="Delete" variant="danger" inline confirm="Delete this upcoming rate?">
                      <input type="hidden" name="id" value={r.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>

        <details className="mt-4" open={!live}>
          <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Add new rate</summary>
          <ActionForm action={addRateAction} submitLabel="Save new rate" className="mt-3" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Air – per kg (৳)">
                <input name="airPerKgBdt" inputMode="decimal" defaultValue={live?.airPerKgBdt?.toString()} placeholder="e.g. 750" className={inputCls} />
              </Field>
              <Field label="Sea – per CBM (৳)">
                <input name="seaPerCbmBdt" inputMode="decimal" defaultValue={live?.seaPerCbmBdt?.toString()} placeholder="e.g. 28000" className={inputCls} />
              </Field>
              <Field label="QA test fee (৳)">
                <input name="qaFeeBdt" inputMode="decimal" defaultValue={live?.qaFeeBdt?.toString()} className={inputCls} />
              </Field>
              <Field label="Home delivery (৳)">
                <input name="localDeliveryBdt" inputMode="decimal" defaultValue={live?.localDeliveryBdt?.toString() ?? v.default_local_delivery_bdt} className={inputCls} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 text-xs font-medium text-gray-600">Starts</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" value="now" defaultChecked /> Now
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" value="later" /> From (Bangladesh time):
                </label>
                <input type="datetime-local" name="startsAt" className={inputCls} aria-label="Start date and time" />
              </fieldset>
              <Field label="Note (e.g. reason for change)" className="sm:col-span-2">
                <input name="note" className={inputCls} />
              </Field>
            </div>
          </ActionForm>
        </details>
      </Card>

      <Card title="Order rules">
        <ActionForm action={saveOrderRulesAction} submitLabel="Save order rules">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Bulk order from quantity" hint="Requests with at least this many pieces are suggested as Bulk">
              <input name="bulkQuantity" type="number" min={1} required defaultValue={v.bulk_threshold.quantity} className={inputCls} />
            </Field>
            <Field label="…or budget from (৳)">
              <input name="bulkValueBdt" inputMode="decimal" required defaultValue={v.bulk_threshold.valueBdt} className={inputCls} />
            </Field>
            <Field label="Price-change alert (%)" hint="Purchase price above the quote by this much needs BD approval">
              <input name="price_change_alert_pct" inputMode="decimal" required defaultValue={v.price_change_alert_pct} className={inputCls} />
            </Field>
            <Field label="BD weight tolerance (%)" hint="Flag when BD weight differs from China weight by more">
              <input name="bd_weight_tolerance_pct" inputMode="decimal" required defaultValue={v.bd_weight_tolerance_pct} className={inputCls} />
            </Field>
          </div>
        </ActionForm>
        {lastUpdated && <p className="mt-2 text-xs text-gray-400">Last changed {fmtDateTime(lastUpdated.at, tz)}{lastUpdated.by ? ` by ${lastUpdated.by}` : ""}.</p>}
      </Card>
    </>
  );
}
