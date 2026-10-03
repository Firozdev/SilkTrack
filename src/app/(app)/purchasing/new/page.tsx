import { ActionForm } from "@/components/action-form";
import { A, Alert, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { docNo, fmtRate, fmtRmb } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { purchaseQueue } from "@/server/purchasing";
import { getCurrentRate } from "@/server/rates";
import { createPurchaseAction } from "../actions";

export default async function NewPurchasePage({ searchParams }: PageProps<"/purchasing/new">) {
  await requirePagePermission("purchase:edit");
  const sp = await searchParams;
  const ids = new Set([sp.lines ?? []].flat());
  const [queue, { rate }, alertPct] = await Promise.all([purchaseQueue(), getCurrentRate(), getSetting("price_change_alert_pct")]);
  const lines = queue.filter((l) => ids.has(l.id) && l.advancePaid);

  if (!lines.length) {
    return (
      <>
        <PageHeader title="Record purchase" />
        <Alert tone="warn">
          No lines selected that are ready to buy (upfront payment confirmed). Go back to the <A href="/purchasing">purchase queue</A> and tick the lines you are buying.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Record purchase" subtitle={`Rate locked on save: 1 RMB = ${rate ? fmtRate(rate.rate) : "—"} BDT. Prices more than ${alertPct}% above the quote need BD approval.`} />
      <ActionForm action={createPurchaseAction} submitLabel="Purchase complete" className="max-w-4xl">
        <Card title="Supplier">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier / shop name *">
              <input name="supplierName" required className={inputCls} />
            </Field>
            <Field label="Platform">
              <select name="platform" defaultValue={lines[0].links[0]?.platform ?? "ALIBABA_1688"} className={inputCls}>
                <option value="ALIBABA_1688">1688</option>
                <option value="TAOBAO">Taobao</option>
                <option value="TMALL">Tmall</option>
                <option value="ALIBABA">Alibaba</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Supplier order no.">
              <input name="supplierOrderNo" className={inputCls} />
            </Field>
            <Field label="Paid with (China)">
              <input name="paymentMethod" placeholder="Alipay / WeChat / bank" className={inputCls} />
            </Field>
            <Field label="China domestic shipping (RMB)">
              <input name="domesticShippingRmb" inputMode="decimal" defaultValue="0" className={inputCls} />
            </Field>
            <Field label="Service charge (RMB)">
              <input name="serviceChargeRmb" inputMode="decimal" defaultValue="0" className={inputCls} />
            </Field>
            <Field label="Order tracking URL *" className="sm:col-span-2" hint="Supplier order / logistics page">
              <input name="trackingUrl" type="url" required placeholder="https://" className={inputCls} />
            </Field>
            <Field label="Estimated receive date (China warehouse) *">
              <input name="expectedArrivalAt" type="date" required className={inputCls} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <input name="notes" className={inputCls} />
            </Field>
            <Field label="Invoice / screenshot">
              <input type="file" name="invoice" accept="image/*,application/pdf" multiple className="text-sm" />
            </Field>
          </div>
        </Card>
        <Card title="Lines">
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.id} className="grid items-end gap-2 border-b border-gray-50 pb-3 sm:grid-cols-5">
                <input type="hidden" name={`l.${i}.orderLineId`} value={l.id} />
                <div className="text-sm sm:col-span-3">
                  <b>{l.productName}</b> <span className="text-gray-500">({docNo("order", l.order.number)})</span>
                  <div className="text-xs text-gray-500">
                    {[l.color, l.size, l.model].filter(Boolean).join(" · ")} · quoted {fmtRmb(l.quotedUnitPriceRmb)} / pc · {l.remaining} left to buy
                  </div>
                </div>
                <Field label="Qty">
                  <input name={`l.${i}.quantity`} type="number" min={0} max={l.remaining} defaultValue={l.remaining} className={inputCls} />
                </Field>
                <Field label="Unit price (RMB)">
                  <input name={`l.${i}.unitPriceRmb`} inputMode="decimal" defaultValue={l.quotedUnitPriceRmb?.toString() ?? ""} required className={inputCls} />
                </Field>
              </div>
            ))}
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
