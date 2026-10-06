import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { resetTokenValid } from "@/server/portal-auth";
import { portalResetAction } from "../../actions";
import { fill } from "../../i18n";
import { getDict } from "../../lang";

export const metadata = { title: "New password · SilkTrack customer portal", referrer: "no-referrer" };

export default async function PortalResetPage({ searchParams }: PageProps<"/portal/reset">) {
  const { t } = await getDict();
  const { token } = await searchParams;
  const valid = typeof token === "string" && (await resetTokenValid(token));
  if (!valid) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold">{t.linkExpired}</h1>
        <p className="text-sm text-gray-600">{t.linkExpiredBody}</p>
        <Link href="/portal/login" className="mt-4 inline-block text-sm font-medium text-blue-700 hover:underline">
          {t.backToLogin}
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">{t.newPwTitle}</h1>
      <ActionForm action={portalResetAction} submitLabel={t.saveAndLogin}>
        <input type="hidden" name="token" value={token} />
        <Field label={fill(t.newPwLabel, { n: MIN_PASSWORD_LENGTH })}>
          <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={inputCls} />
        </Field>
        <Field label={t.repeatPwShort}>
          <input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={inputCls} />
        </Field>
      </ActionForm>
    </>
  );
}
