import { notFound } from "next/navigation";
import { fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg } from "@/lib/format";
import { canSeeSelling } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getQuotation } from "@/server/estimates";
import { quoteBreakdown } from "@/server/quote-breakdown";
import { getDocumentBranding } from "@/server/organization";
import { DocumentHeader, PaymentDetails } from "@/components/document-branding";
import { PrintButton } from "./print-button";

// Customer-facing quotation in BDT. Use the browser's "Save as PDF".
export default async function CustomerQuote({ params }: PageProps<"/estimates/[id]/quote">) {
  const user = await requireUser();
  if (!canSeeSelling(user)) notFound();
  const { id } = await params;
  const e = await getQuotation(id);
  if (!e || !e.grandTotalBdt) notFound();
  const [b, branding] = await Promise.all([quoteBreakdown(e), getDocumentBranding()]);
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-gray-900 print:p-0">
      <div className="no-print mb-6 flex justify-end gap-2">
        <a href={`/documents/quote/${e.id}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
          ⬇ Download PDF
        </a>
        <PrintButton />
      </div>
      <DocumentHeader branding={branding}>
        <div className="text-lg font-semibold">QUOTATION</div>
        <div>
          {docNo("estimate", e.number)} v{e.version}
        </div>
        <div className="text-xs text-gray-500">Order {docNo("order", e.order.number)}</div>
      </DocumentHeader>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-gray-500">Customer</div>
          <div className="font-medium">
            {e.order.customer.name} ({e.order.customer.code})
          </div>
          <div>{e.order.customer.phone}</div>
          <div>{[e.order.customer.address, e.order.customer.district].filter(Boolean).join(", ")}</div>
        </div>
        <div className="text-right">
          <div>Date: {fmtDay(e.sentAt ?? e.updatedAt)}</div>
          <div>Valid until: {fmtDay(e.validUntil)}</div>
          <div>Shipping: {e.shippingMethod === "AIR" ? "Air" : "Sea"}</div>
        </div>
      </div>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-500">
            <th className="py-2">#</th>
            <th className="py-2">Product</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {e.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-gray-100">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">
                {l.productName}
                <div className="text-xs text-gray-500">{[l.orderLine?.color, l.orderLine?.size, l.orderLine?.model].filter(Boolean).join(" · ")}</div>
              </td>
              <td className="py-2 text-right">{l.quantity}</td>
              <td className="py-2 text-right tabular-nums">{fmtBdt(b.lines[i].unitPrice)}</td>
              <td className="py-2 text-right tabular-nums">{fmtBdt(l.sellingPriceBdt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-3 text-right font-semibold">
              Total purchase price (products, incl. China costs)
            </td>
            <td className="pt-3 text-right font-semibold tabular-nums">{fmtBdt(b.products)}</td>
          </tr>
          {b.shipping && (
            <>
              <tr>
                <td colSpan={4} className="pt-1 text-right">
                  Estimated shipping to Bangladesh ({e.shippingMethod === "AIR" ? "air" : "sea"}: {b.shipping.unit === "kg" ? fmtKg(b.shipping.basis) : fmtCbm(b.shipping.basis)} × {fmtBdt(b.shipping.rate)}/
                  {b.shipping.unit})
                </td>
                <td className="pt-1 text-right tabular-nums">{fmtBdt(b.shipping.amount)}</td>
              </tr>
              {b.delivery.gt(0) && (
                <tr>
                  <td colSpan={4} className="pt-1 text-right">
                    Home delivery
                  </td>
                  <td className="pt-1 text-right tabular-nums">{fmtBdt(b.delivery)}</td>
                </tr>
              )}
              <tr className="border-t border-gray-300">
                <td colSpan={4} className="pt-2 text-right font-semibold">
                  Estimated total
                </td>
                <td className="pt-2 text-right text-base font-bold tabular-nums">≈ {fmtBdt(b.estimatedTotal)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      <p className="mt-6 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        ⚠{" "}
        {b.shipping
          ? "Shipping is an estimate from the expected weight / CBM. It can change depending on your lot – the actual weight and size when it reaches our China warehouse."
          : "Shipping is added later, based on the actual weight / CBM of your lot."}{" "}
        The final shipping is billed when your goods arrive in Bangladesh.
      </p>
      <p className="mt-4 text-xs text-gray-500">
        Prices in Bangladeshi Taka. An upfront payment for the products is required before purchase. This quotation expires on {fmtDay(e.validUntil)}.
      </p>
      <PaymentDetails branding={branding} reference={docNo("order", e.order.number)} />
    </div>
  );
}
