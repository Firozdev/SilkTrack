import "server-only";
import { headers } from "next/headers";

/** Public origin of this request (behind Caddy / a tunnel the proxy sets the host). */
export async function origin() {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
