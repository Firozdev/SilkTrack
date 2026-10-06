import { getPortalAccount } from "@/lib/portal-session";
import { readAttachment } from "@/lib/uploads";
import { portalAttachment } from "@/server/portal";

// Serves a file to the customer only if it belongs to their own records.
export async function GET(_req: Request, ctx: RouteContext<"/portal/files/[id]">) {
  const acc = await getPortalAccount();
  if (!acc) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const att = await portalAttachment(acc.customer.id, id);
  if (!att) return new Response("Not found", { status: 404 });
  try {
    const body = await readAttachment(att.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(att.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
