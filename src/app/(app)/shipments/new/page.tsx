import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputCls } from "@/components/ui";
import { CN_TZ, addDays, isoWeek, isoWeekStart, toYmd, today } from "@/lib/dates";
import { requirePagePermission } from "@/lib/session";
import { createShipmentAction } from "../actions";

export default async function PlanShipmentPage() {
  await requirePagePermission("shipment:edit");
  // Suggest next week's Saturday as the cut-off.
  const now = today(CN_TZ);
  const next = isoWeek(addDays(now, 7));
  const suggestedCutoff = toYmd(addDays(isoWeekStart(next.year, next.week), 5));

  return (
    <>
      <PageHeader title="Plan a shipment" subtitle="The shipment code (e.g. SHP-2026-W41-A) comes from the method and the week of the cut-off date. Blank dates use the defaults." />
      <ActionForm action={createShipmentAction} submitLabel="Create shipment" className="max-w-3xl">
        <Card title="Schedule">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Method *">
              <select name="method" className={inputCls}>
                <option value="AIR">Air</option>
                <option value="SEA">Sea</option>
              </select>
            </Field>
            <Field label="Cut-off date (last day to add items) *">
              <input type="date" name="cutoffDate" required defaultValue={suggestedCutoff} className={inputCls} />
            </Field>
            <Field label="Planned departure" hint="Default: 2 days after cut-off">
              <input type="date" name="plannedDepartureDate" className={inputCls} />
            </Field>
            <Field label="ETA Bangladesh" hint="Default: departure + 5 days (air) / 30 days (sea)">
              <input type="date" name="etaBd" className={inputCls} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="openNow" /> Open now (accept received items immediately)
          </label>
        </Card>
        <Card title="Carrier & capacity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Forwarder / cargo agent">
              <input name="forwarder" className={inputCls} />
            </Field>
            <Field label="AWB / B/L / container no.">
              <input name="masterTrackingNo" className={inputCls} />
            </Field>
            <Field label="Max gross weight (kg)">
              <input name="maxWeightKg" inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Max CBM">
              <input name="maxCbm" inputMode="decimal" className={inputCls} />
            </Field>
          </div>
          <Field label="Notes" className="mt-3">
            <textarea name="notes" rows={2} className={inputCls} />
          </Field>
        </Card>
      </ActionForm>
    </>
  );
}
