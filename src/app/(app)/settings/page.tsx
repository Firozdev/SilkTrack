import { ActionForm } from "@/components/action-form";
import { Card, Field, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { allSettings } from "@/server/settings";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { saveOrderRulesAction } from "./actions";

/** General settings (order rules). Non-admins land on exchange rates. */
export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user.role, "settings:manage")) redirect("/settings/exchange-rates");
  const { values: v, lastUpdated } = await allSettings();
  const tz = user.timezone;

  return (
    <>
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
