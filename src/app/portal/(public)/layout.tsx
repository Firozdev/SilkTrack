import { Suspense, type ReactNode } from "react";
import { getDict } from "../lang";
import { LangSwitch } from "../lang-switch";

export default async function PortalPublicLayout({ children }: { children: ReactNode }) {
  const { lang, t } = await getDict();
  return (
    <main lang={lang} className="flex min-h-dvh items-start justify-center bg-gray-50 px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-end">
          <Suspense>
            <LangSwitch lang={lang} label={t.language} />
          </Suspense>
        </div>
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold text-gray-900">{t.brand}</div>
          <div className="text-sm text-gray-500">{t.tagline}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
