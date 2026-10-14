import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { portalSignUpAction } from "../../actions";
import { fill } from "../../i18n";
import { getDict } from "../../lang";

export const metadata = { title: "Sign up · SilkTrack customer portal" };

export default async function PortalSignUpPage() {
  const { t } = await getDict();
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">{t.signUpTitle}</h1>
      <p className="mb-4 text-sm text-gray-500">{t.signUpIntro}</p>
      <ActionForm action={portalSignUpAction} submitLabel={t.signUp} resetOnSuccess>
        <Field label={t.fullName}>
          <input name="name" required autoComplete="name" className={inputCls} />
        </Field>
        <Field label={t.mobileReq} hint={t.mobileHint}>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="01XXXXXXXXX" className={inputCls} />
        </Field>
        <Field label={t.email}>
          <input name="email" type="email" autoComplete="email" className={inputCls} />
        </Field>
        <Field label={t.addressReq}>
          <textarea name="address" required rows={2} autoComplete="street-address" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.district}>
            <input name="district" className={inputCls} />
          </Field>
          <Field label={t.area}>
            <input name="area" className={inputCls} />
          </Field>
        </div>
        <Field label={fill(t.passwordMin, { n: MIN_PASSWORD_LENGTH })}>
          <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={inputCls} />
        </Field>
        <Field label={t.repeatPw}>
          <input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={inputCls} />
        </Field>
      </ActionForm>
      <p className="mt-4 text-sm text-gray-600">
        {t.haveAccount}{" "}
        <Link href="/portal/login" className="font-medium text-blue-700 hover:underline">
          {t.logIn}
        </Link>
      </p>
    </>
  );
}
