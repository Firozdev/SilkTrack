import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountForSession, createSession, endSession } from "@/server/portal-auth";

/**
 * Customer portal session cookie. Separate from the staff Auth.js session:
 * different cookie, scoped to /portal, and backed by PortalSession rows.
 */
export const PORTAL_COOKIE = "st_portal";

export async function getPortalAccount() {
  return accountForSession((await cookies()).get(PORTAL_COOKIE)?.value);
}

export type PortalAccountSession = NonNullable<Awaited<ReturnType<typeof getPortalAccount>>>;

/** For portal pages and actions: redirect to the portal login when not signed in. */
export async function requirePortalAccount(): Promise<PortalAccountSession> {
  const acc = await getPortalAccount();
  if (!acc) redirect("/portal/login");
  return acc;
}

/** Server functions only. */
export async function startPortalSession(accountId: string) {
  const { token, expiresAt } = await createSession(accountId);
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/portal", expires: expiresAt });
}

/** Server functions only. */
export async function endPortalSession() {
  const store = await cookies();
  await endSession(store.get(PORTAL_COOKIE)?.value);
  store.delete({ name: PORTAL_COOKIE, path: "/portal" });
}
