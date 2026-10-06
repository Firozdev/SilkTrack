import { ActionForm } from "@/components/action-form";
import { Alert, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { fmtBdt } from "@/lib/format";
import { estimateShipping } from "@/lib/shipping-estimate";
import { requirePagePermission } from "@/lib/session";
import { allSettings, rateCard } from "@/server/settings";
import { saveOrderRulesAction, saveRatesAction } from "./actions";

export default async function SettingsPage() {
  const user = await requirePagePermission("settings:manage");
  const [{ values: v, lastUpdated }, rates] = await Promise.all([allSettings(), rateCard()]);
  const airEx = estimateShipping({ method: "AIR", weightKg: 10 }, rates);
  const seaEx = estimateShipping({ method: "SEA", cbm: 1 }, rates);
  return (
    <>
      <PageHeader title="Settings" subtitle={lastUpdated ? `Last changed ${fmtDateTime(lastUpdated.at, user.timezone)}${lastUpdated.by ? ` by ${lastUpdated.by}` : ""}. Every change is in the audit log.` : "Only Admin can change these."} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Shipping charges (BDT)">
          <p className="mb-3 text-sm text-gray-600">
            Customers see these as an <b>estimated</b> cost when they place a shipping order in the portal (their estimated weight / CBM × rate). The final bill uses the weight measured at
            our China warehouse. Invoices are prefilled with these rates.
          </p>
          <ActionForm action={saveRatesAction} submitLabel="Save shipping charges">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Air – per kg (৳)" hint="Blank = no estimate shown for air">
                <input name="shipping_service_air_per_kg_bdt" inputMode="decimal" defaultValue={v.shipping_service_air_per_kg_bdt} placeholder="e.g. 750" className={inputCls} />
              </Field>
              <Field label="Sea – per CBM (৳)" hint="Blank = no estimate shown for sea">
                <input name="shipping_service_sea_per_cbm_bdt" inputMode="decimal" defaultValue={v.shipping_service_sea_per_cbm_bdt} placeholder="e.g. 28000" className={inputCls} />
              </Field>
              <Field label="QA test fee (৳)" hint="Added when the customer asks for a quality check">
                <input name="shipping_service_qa_fee_bdt" inputMode="decimal" defaultValue={v.shipping_service_qa_fee_bdt} className={inputCls} />
              </Field>
              <Field label="Home delivery (৳)">
                <input name="default_local_delivery_bdt" inputMode="decimal" required defaultValue={v.default_local_delivery_bdt} className={inputCls} />
              </Field>
            </div>
          </ActionForm>
          <div className="mt-4">
            {airEx || seaEx ? (
              <Alert tone="info">
                Customer sees, for example: {airEx && <>10 kg by air ≈ <b>{fmtBdt(airEx.total)}</b> </>}
                {airEx && seaEx && "· "}
                {seaEx && <>1 CBM by sea ≈ <b>{fmtBdt(seaEx.total)}</b></>} (including home delivery).
              </Alert>
            ) : (
              <Alert tone="warn">No rates set yet – customers don&apos;t see an estimate.</Alert>
            )}
          </div>
        </Card>
        <Card title="Order rules">
          <ActionForm action={saveOrderRulesAction} submitLabel="Save order rules">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bulk order from quantity" hint="Requests with at least this many pieces are suggested as Bulk">
                <input name="bulkQuantity" type="number" min={1} required defaultValue={v.bulk_threshold.quantity} className={inputCls} />
              </Field>
              <Field label="…or budget from (৳)">
                <input name="bulkValueBdt" inputMode="decimal" required defaultValue={v.bulk_threshold.valueBdt} className={inputCls} />
              </Field>
              <Field label="Price-change alert (%)" hint="China purchase price above the quote by this much needs BD approval">
                <input name="price_change_alert_pct" inputMode="decimal" required defaultValue={v.price_change_alert_pct} className={inputCls} />
              </Field>
              <Field label="BD weight tolerance (%)" hint="Flag when BD weight differs from China weight by more">
                <input name="bd_weight_tolerance_pct" inputMode="decimal" required defaultValue={v.bd_weight_tolerance_pct} className={inputCls} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
