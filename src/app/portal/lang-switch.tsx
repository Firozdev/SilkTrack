"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { setLangAction } from "./actions";

/** English ⇄ বাংলা toggle; returns to the same page. */
export function LangSwitch({ lang, label }: { lang: "en" | "bn"; label: string }) {
  const path = usePathname();
  const q = useSearchParams().toString();
  return (
    <form action={setLangAction}>
      <input type="hidden" name="lang" value={lang === "bn" ? "en" : "bn"} />
      <input type="hidden" name="back" value={q ? `${path}?${q}` : path} />
      <button className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" lang={lang === "bn" ? "en" : "bn"}>
        {label}
      </button>
    </form>
  );
}
