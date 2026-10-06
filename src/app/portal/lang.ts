import "server-only";
import { cookies } from "next/headers";
import { DICTS, LANG_COOKIE, type Lang } from "./i18n";

/** Portal language from the cookie (set at login from the account, or by the switch). */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === "bn" ? "bn" : "en";
}

export async function getDict() {
  const lang = await getLang();
  return { lang, t: DICTS[lang] };
}

/** Server functions only. */
export async function setLangCookie(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang, { path: "/portal", sameSite: "lax", maxAge: 365 * 86_400, httpOnly: true, secure: process.env.NODE_ENV === "production" });
}
