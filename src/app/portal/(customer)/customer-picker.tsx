import { Card, Field, inputCls } from "@/components/ui";
import type { Dict } from "../i18n";

export type PickCustomer = { id: string; code: string; name: string; phone: string };

/** Agents choose which of their customers a new request is for. */
export function CustomerPicker({ t, customers }: { t: Dict; customers: PickCustomer[] }) {
  return (
    <Card title={t.colCustomer}>
      <Field label={t.customerFor} className="max-w-md">
        <select name="customerId" required defaultValue="" className={inputCls}>
          <option value="" disabled>
            {t.chooseCustomer}
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.code} · {c.phone}
            </option>
          ))}
        </select>
      </Field>
    </Card>
  );
}
