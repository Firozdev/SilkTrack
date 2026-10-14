import type { DocumentKind } from "@/generated/prisma/client";
import { can, canSeeSelling } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { readAttachment } from "@/lib/uploads";
import { prisma } from "@/lib/prisma";
import { generateQuotePdf, generateReceipt, generateShippingInvoice, latestDocument } from "@/server/documents";

// Download a generated PDF: /documents/shipping-invoice/<shippingOrderId>, /documents/receipt/<paymentId>,
// /documents/quote/<estimateId>. ?v=<documentId> picks an older version. Staff who can see invoices only.
const KINDS = {
  "shipping-invoice": { kind: "SHIPPING_INVOICE", link: (id: string) => ({ shippingOrderId: id }), make: generateShippingInvoice },
  receipt: { kind: "PAYMENT_RECEIPT", link: (id: string) => ({ paymentId: id }), make: generateReceipt },
  quote: { kind: "QUOTE", link: (id: string) => ({ estimateId: id }), make: generateQuotePdf },
} as const satisfies Record<string, { kind: DocumentKind; link: (id: string) => object; make: (id: string, actorId: string | null) => Promise<unknown> }>;

export async function GET(req: Request, ctx: RouteContext<"/documents/[kind]/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!can(user.role, "invoice:view") || !canSeeSelling(user)) return new Response("Forbidden", { status: 403 });
  const { kind: k, id } = await ctx.params;
  const spec = KINDS[k as keyof typeof KINDS];
  if (!spec) return new Response("Not found", { status: 404 });
  const version = new URL(req.url).searchParams.get("v");
  const link = spec.link(id);
  let doc = version ? await prisma.generatedDocument.findFirst({ where: { id: version, kind: spec.kind, ...link } }) : await latestDocument(spec.kind, link);
  // Made before PDFs existed (or generation failed): make it now.
  if (!doc && !version) {
    await spec.make(id, user.id);
    doc = await latestDocument(spec.kind, link);
  }
  if (!doc) return new Response("Not found", { status: 404 });
  try {
    const body = await readAttachment(doc.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${doc.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
