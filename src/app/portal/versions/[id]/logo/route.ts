import { getPortalAccount } from "@/lib/portal-session";
import { versionLogo } from "@/server/custom-invoices";

// Preview of the logo the customer uploaded for their version. Owner only; PNG/JPG only.
export async function GET(_req: Request, ctx: RouteContext<"/portal/versions/[id]/logo">) {
  const acc = await getPortalAccount();
  if (!acc) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const l = await versionLogo(acc, id);
  if (!l) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(l.body), { headers: { "Content-Type": l.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
