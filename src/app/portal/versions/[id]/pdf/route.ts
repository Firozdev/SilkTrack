import { getPortalAccount } from "@/lib/portal-session";
import { versionPdf } from "@/server/custom-invoices";

// The customer's own version as PDF (made fresh from the saved data). Owner only.
export async function GET(_req: Request, ctx: RouteContext<"/portal/versions/[id]/pdf">) {
  const acc = await getPortalAccount();
  if (!acc) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const r = await versionPdf(acc, id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
