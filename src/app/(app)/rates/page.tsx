import { ActionForm } from "@/components/action-form";
import { RateChart } from "@/components/rate-chart";
import { Card, Field, PageHeader, Table, inputCls, tdCls } from "@/components/ui";
import { BD_TZ, fmtDateTime, fmtDay, toYmd, today } from "@/lib/dates";
import { fmtRate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listRates } from "@/server/rates";
import { saveRateAction } from "./actions";

export default async function RatesPage() {
  const user = await requireUser();
  const rates = await listRates(180);
  const points = [...rates].reverse().map((r) => ({ date: toYmd(r.effectiveDate), rate: r.rate.toString() }));

  return (
    <>
      <PageHeader title="Exchange rates (RMB → BDT)" subtitle="One rate per day. Every purchase, estimate and invoice locks the rate in force when it is saved." />
      <div className="grid gap-5 lg:grid-cols-3">
        {can(user.role, "rate:edit") && (
          <Card title="Add or update a rate">
            <ActionForm action={saveRateAction} submitLabel="Save rate">
              <Field label="Effective date">
                <input type="date" name="date" defaultValue={toYmd(today(BD_TZ))} required className={inputCls} />
              </Field>
              <Field label="Rate: 1 RMB = ? BDT">
                <input name="rate" inputMode="decimal" required placeholder="17.2500" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Buying rate (optional)">
                  <input name="buyingRate" inputMode="decimal" className={inputCls} />
                </Field>
                <Field label="Selling rate (optional)">
                  <input name="sellingRate" inputMode="decimal" className={inputCls} />
                </Field>
              </div>
              <Field label="Note">
                <input name="note" className={inputCls} />
              </Field>
            </ActionForm>
          </Card>
        )}
        <Card title="Rate trend" className={can(user.role, "rate:edit") ? "lg:col-span-2" : "lg:col-span-3"}>
          <RateChart points={points} />
        </Card>
      </div>
      <Card title="Rate history" className="mt-5">
        <Table head={["Date", "Rate", "Buying", "Selling", "Note", "Updated by", "Updated at"]} empty="No rates yet.">
          {rates.map((r) => (
            <tr key={r.id}>
              <td className={tdCls}>{fmtDay(r.effectiveDate)}</td>
              <td className={`${tdCls} font-semibold`}>{fmtRate(r.rate)}</td>
              <td className={tdCls}>{fmtRate(r.buyingRate)}</td>
              <td className={tdCls}>{fmtRate(r.sellingRate)}</td>
              <td className={tdCls}>{r.note}</td>
              <td className={tdCls}>{r.updatedBy.name}</td>
              <td className={tdCls}>{fmtDateTime(r.updatedAt, user.timezone)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
