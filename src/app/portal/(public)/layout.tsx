import { Suspense, type ReactNode } from "react";
import { getDict } from "../lang";
import { LangSwitch } from "../lang-switch";
import { Logo } from "@/components/logo";
import { AuthBackdrop } from "@/components/auth-backdrop";

export default async function PortalPublicLayout({ children }: { children: ReactNode }) {
  const { lang, t } = await getDict();
  return (
    <AuthBackdrop>
      <main lang={lang} className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md">
          <div className="mb-2 flex justify-end">
            <Suspense>
              <LangSwitch lang={lang} label={t.language} />
            </Suspense>
          </div>
          <div className="mb-6 text-center">
            <div className="text-2xl font-semibold text-gray-900">
              <Logo name={t.brand} size={32} />
            </div>
            <div className="text-sm text-gray-500">{t.tagline}</div>
          </div>
          <div className="rounded-xl border border-gray-200/80 bg-white/90 p-6 shadow-lg shadow-blue-900/5 backdrop-blur-sm">{children}</div>
        </div>
      </main>
    </AuthBackdrop>
  );
}
