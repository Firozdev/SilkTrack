"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import type { CustomInvoiceData } from "@/lib/custom-invoice";
import type { Dict } from "../../i18n";

/** Money preview in paisa (the server recalculates with decimals on save). */
const paisa = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};
const lineAmount = (qty: string, unit: string) => Math.round((Number(qty) || 0) * paisa(unit)) || 0;
const fmt = (p: number) => `৳${(p / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Edit every part of the customer's own invoice version, with live totals. */
export function VersionEditor({
  t,
  initial,
  action,
  hidden,
  logoUrl,
  submitLabel,
}: {
  t: Dict;
  initial: CustomInvoiceData;
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  logoUrl: string | null;
  submitLabel: string;
}) {
  const [d, setD] = useState<CustomInvoiceData>(initial);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);
  useEffect(() => () => void (preview?.startsWith("blob:") && URL.revokeObjectURL(preview)), [preview]);

  const set = <K extends keyof CustomInvoiceData>(k: K, v: CustomInvoiceData[K]) => setD((x) => ({ ...x, [k]: v }));
  const setIn = <K extends "business" | "billTo">(k: K, f: keyof CustomInvoiceData[K], v: string) => setD((x) => ({ ...x, [k]: { ...x[k], [f]: v } }));
  const setRow = <K extends "items" | "charges" | "accounts">(k: K, i: number, patch: Partial<CustomInvoiceData[K][number]>) =>
    setD((x) => ({ ...x, [k]: (x[k] as CustomInvoiceData[K][number][]).map((r, n) => (n === i ? { ...r, ...patch } : r)) }));
  const removeRow = (k: "items" | "charges" | "accounts", i: number) => setD((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, n) => n !== i) }));

  const lines = d.items.map((i) => lineAmount(i.qty, i.unitPrice));
  const subtotal = lines.reduce((a, b) => a + b, 0) + d.charges.reduce((a, c) => a + paisa(c.amount), 0);
  const total = subtotal - paisa(d.discount);
  const balance = Math.max(0, total - paisa(d.paid));
  const input = (value: string, onChange: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} {...extra} />
  );

  return (
    <ActionForm action={action} submitLabel={submitLabel} className="max-w-4xl">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="data" value={JSON.stringify(d)} />

      <Card title={t.yourBusiness}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.versionName}>{input(d.label, (v) => set("label", v), { required: true, maxLength: 80 })}</Field>
          <Field label={t.logoLabel} hint={t.logoHint}>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-24 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the customer's own logo */}
                {preview && !removeLogo ? <img src={preview} alt="" className="max-h-10 max-w-20 object-contain" /> : <span className="text-[10px] text-gray-400">—</span>}
              </div>
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                className="text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPreview(URL.createObjectURL(f));
                    setRemoveLogo(false);
                  }
                }}
              />
            </div>
            {logoUrl && (
              <label className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" name="removeLogo" value="yes" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} /> {t.removeLogo}
              </label>
            )}
          </Field>
          <Field label={t.businessName}>{input(d.business.name, (v) => setIn("business", "name", v), { maxLength: 200 })}</Field>
          <Field label={t.bizPhone}>{input(d.business.phone, (v) => setIn("business", "phone", v), { maxLength: 200 })}</Field>
          <Field label={t.bizEmail}>{input(d.business.email, (v) => setIn("business", "email", v), { maxLength: 200 })}</Field>
          <Field label={t.bizAddress}>
            <textarea value={d.business.address} onChange={(e) => setIn("business", "address", e.target.value)} rows={2} maxLength={1000} className={inputCls} />
          </Field>
        </div>
      </Card>

      <Card title={t.billToTitle}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t.invoiceNoLabel}>{input(d.invoiceNo, (v) => set("invoiceNo", v), { maxLength: 60 })}</Field>
          <Field label={t.invoiceDateLabel}>{input(d.invoiceDate, (v) => set("invoiceDate", v), { type: "date", required: true })}</Field>
          <Field label={t.dueDateLabel}>{input(d.dueDate, (v) => set("dueDate", v), { type: "date" })}</Field>
          <Field label={t.nameLabel}>{input(d.billTo.name, (v) => setIn("billTo", "name", v), { maxLength: 200 })}</Field>
          <Field label={t.bizPhone}>{input(d.billTo.phone, (v) => setIn("billTo", "phone", v), { maxLength: 200 })}</Field>
          <Field label={t.bizAddress}>{input(d.billTo.address, (v) => setIn("billTo", "address", v), { maxLength: 1000 })}</Field>
        </div>
      </Card>

      <Card title={t.lineItems}>
        <div className="space-y-2">
          {d.items.map((it, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_8rem_8rem_auto]">
              <Field label={i === 0 ? t.descriptionLabel : ""}>{input(it.description, (v) => setRow("items", i, { description: v }), { required: true, maxLength: 200 })}</Field>
              <Field label={i === 0 ? t.qtyLabel : ""}>{input(it.qty, (v) => setRow("items", i, { qty: v }), { inputMode: "decimal", required: true })}</Field>
              <Field label={i === 0 ? t.unitPriceLabel : ""}>{input(it.unitPrice, (v) => setRow("items", i, { unitPrice: v }), { inputMode: "decimal" })}</Field>
              <div className="pb-2 text-right text-sm tabular-nums">{fmt(lines[i])}</div>
              <button type="button" disabled={d.items.length === 1} onClick={() => removeRow("items", i)} className={`${btnCls} disabled:opacity-40`}>
                {t.removeRow}
              </button>
            </div>
          ))}
          <button type="button" className={btnCls} onClick={() => set("items", [...d.items, { description: "", qty: "1", unitPrice: "0" }])} disabled={d.items.length >= 50}>
            {t.addLine}
          </button>
        </div>
      </Card>

      <Card title={t.chargesTitle}>
        <div className="space-y-2">
          {d.charges.map((c, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_auto]">
              <Field label={i === 0 ? t.chargeLabel : ""}>{input(c.label, (v) => setRow("charges", i, { label: v }), { required: true, maxLength: 80 })}</Field>
              <Field label={i === 0 ? t.amountLabel : ""}>{input(c.amount, (v) => setRow("charges", i, { amount: v }), { inputMode: "decimal" })}</Field>
              <button type="button" onClick={() => removeRow("charges", i)} className={btnCls}>
                {t.removeRow}
              </button>
            </div>
          ))}
          <button type="button" className={btnCls} onClick={() => set("charges", [...d.charges, { label: "", amount: "0" }])} disabled={d.charges.length >= 10}>
            {t.addCharge}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_16rem]">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.discountLabel}>{input(d.discount, (v) => set("discount", v), { inputMode: "decimal" })}</Field>
            <Field label={t.amountPaidLabel}>{input(d.paid, (v) => set("paid", v), { inputMode: "decimal" })}</Field>
          </div>
          <dl className="space-y-1 rounded-md bg-gray-50 p-3 text-sm tabular-nums">
            <div className="flex justify-between">
              <dt className="text-gray-600">{t.subtotalLabel}</dt>
              <dd>{fmt(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t.discountLabel}</dt>
              <dd>−{fmt(paisa(d.discount))}</dd>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
              <dt>{t.totalLabel}</dt>
              <dd className={total < 0 ? "text-red-700" : ""}>{fmt(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t.amountPaidLabel}</dt>
              <dd>−{fmt(paisa(d.paid))}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t.balanceDue}</dt>
              <dd>{fmt(balance)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card title={t.payInfo}>
        <div className="space-y-3">
          {d.accounts.map((a, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-4">
              <Field label={t.providerLabel}>{input(a.provider, (v) => setRow("accounts", i, { provider: v }), { required: true, maxLength: 80 })}</Field>
              <Field label={t.accountNameLabel}>{input(a.accountName, (v) => setRow("accounts", i, { accountName: v }), { maxLength: 120 })}</Field>
              <Field label={t.accountNoLabel}>{input(a.accountNumber, (v) => setRow("accounts", i, { accountNumber: v }), { required: true, maxLength: 60 })}</Field>
              <div className="flex items-end gap-2">
                <Field label={t.notesLabel} className="flex-1">
                  {input(a.notes, (v) => setRow("accounts", i, { notes: v }), { maxLength: 200 })}
                </Field>
                <button type="button" onClick={() => removeRow("accounts", i)} className={btnCls}>
                  {t.removeRow}
                </button>
              </div>
            </div>
          ))}
          <button type="button" className={btnCls} onClick={() => set("accounts", [...d.accounts, { provider: "", accountName: "", accountNumber: "", notes: "" }])} disabled={d.accounts.length >= 6}>
            {t.addAccount}
          </button>
        </div>
      </Card>

      <Card title={t.notesLabel}>
        <textarea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={1000} className={inputCls} />
      </Card>
    </ActionForm>
  );
}
