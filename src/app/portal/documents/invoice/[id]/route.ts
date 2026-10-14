import { getPortalAccount } from "@/lib/portal-session";
import { readAttachment } from "@/lib/uploads";
import { ownerOf } from "@/server/portal-access";
import { generateShippingInvoice, latestDocument } from "@/server/documents";

// Our original invoice PDF for a Ship for Me order – the same file staff download.
// Only the order's own customer (or their agent) can get it.
export async function GET(_req: Request, ctx: RouteContext<"/portal/documents/invoice/[id]">) {
  const acc = await getPortalAccount();
  if (!acc) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownerOf(acc, "shipping", id))) return new Response("Not found", { status: 404 });
  let doc = await latestDocument("SHIPPING_INVOICE", { shippingOrderId: id });
  if (!doc) {
    await generateShippingInvoice(id, null);
    doc = await latestDocument("SHIPPING_INVOICE", { shippingOrderId: id });
  }
  if (!doc) return new Response("Not found", { status: 404 });
  try {
    const body = await readAttachment(doc.storageKey);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${doc.number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
