import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { tokenValid } from "@/server/portal-auth";
import { portalAcceptInviteAction } from "../../actions";
import { fill } from "../../i18n";
import { getDict } from "../../lang";

export const metadata = { title: "Welcome · SilkTruck customer portal", referrer: "no-referrer" };

export default async function PortalInvitePage({ searchParams }: PageProps<"/portal/invite">) {
  const { t } = await getDict();
  const { token } = await searchParams;
  const valid = typeof token === "string" ? await tokenValid(token, "INVITE") : null;
  if (!valid) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold">{t.linkExpired}</h1>
        <p className="text-sm text-gray-600">{t.inviteExpired}</p>
        <Link href="/portal/login" className="mt-4 inline-block text-sm font-medium text-blue-700 hover:underline">
          {t.backToLogin}
        </Link>
      </>
    );
  }
  const acc = await prisma.portalAccount.findUniqueOrThrow({ where: { id: valid.accountId }, select: { name: true, phone: true } });
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">{fill(t.inviteTitle, { name: acc.name })}</h1>
      <p className="mb-4 text-sm text-gray-600">{fill(t.inviteIntro, { phone: acc.phone })}</p>
      <ActionForm action={portalAcceptInviteAction} submitLabel={t.saveAndLogin}>
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
