import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { getPortalAccount } from "@/lib/portal-session";
import { portalLoginAction } from "../../actions";
import { getDict } from "../../lang";

export const metadata = { title: "Log in · SilkTruck customer portal" };

export default async function PortalLoginPage() {
  if (await getPortalAccount()) redirect("/portal");
  const { t } = await getDict();
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">{t.logIn}</h1>
      <ActionForm action={portalLoginAction} submitLabel={t.logIn}>
        <Field label={t.mobile}>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="01XXXXXXXXX" className={inputCls} />
        </Field>
        <Field label={t.password}>
          <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
        </Field>
      </ActionForm>
      <p className="mt-4 text-sm text-gray-600">
        {t.newHere}{" "}
        <Link href="/portal/signup" className="font-medium text-blue-700 hover:underline">
          {t.createAccount}
        </Link>
      </p>
      <p className="mt-1 text-xs text-gray-400">{t.forgotPw}</p>
    </>
  );
}
