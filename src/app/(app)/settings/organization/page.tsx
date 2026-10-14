import { ActionForm } from "@/components/action-form";
import { Card, Field, inputCls } from "@/components/ui";
import { requirePagePermission } from "@/lib/session";
import { getDocumentBranding } from "@/server/organization";
import { saveOrganizationAction } from "../actions";
import { LogoInput } from "./logo-input";

/** Organization details printed on every PDF (Admin only). */
export default async function OrganizationSettingsPage() {
  await requirePagePermission("settings:manage");
  const { org, logoUrl } = await getDocumentBranding();
  return (
    <Card title="Organization">
      <p className="mb-4 text-sm text-gray-500">Shown at the top of every quotation, invoice and payment receipt.</p>
      <ActionForm action={saveOrganizationAction} submitLabel="Save organization details" className="max-w-3xl">
        <Field label="Logo">
          <LogoInput current={logoUrl} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organization name *">
            <input name="name" required defaultValue={org.name} className={inputCls} />
          </Field>
          <Field label="Tagline" hint="Optional line under the name">
            <input name="tagline" defaultValue={org.tagline} className={inputCls} />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" defaultValue={org.phone} className={inputCls} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={org.email} className={inputCls} />
          </Field>
          <Field label="Website">
            <input name="website" placeholder="www.example.com" defaultValue={org.website} className={inputCls} />
          </Field>
        </div>
        <Field label="Address">
          <textarea name="address" rows={3} defaultValue={org.address} className={inputCls} />
        </Field>
      </ActionForm>
    </Card>
  );
}
