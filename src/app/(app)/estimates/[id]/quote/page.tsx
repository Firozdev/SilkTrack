import { notFound } from "next/navigation";
import { fmtDay } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { canSeeSelling } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getQuotation } from "@/server/estimates";
import { PrintButton } from "./print-button";

// Customer-facing quotation in BDT. Use the browser's "Save as PDF".
export default async function CustomerQuote({ params }: PageProps<"/estimates/[id]/quote">) {
  const user = await requireUser();
  if (!canSeeSelling(user)) notFound();
  const { id } = await params;
  const e = await getQuotation(id);
  if (!e || !e.grandTotalBdt) notFound();
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-gray-900 print:p-0">
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>
      <div className="flex items-start justify-between border-b-2 border-blue-700 pb-4">
        <div>
          <div className="text-2xl font-bold text-blue-700">SilkTrack</div>
          <div className="text-xs text-gray-500">China sourcing &amp; shipping to your door</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">QUOTATION</div>
          <div>
            {docNo("estimate", e.number)} v{e.version}
          </div>
          <div className="text-xs text-gray-500">Order {docNo("order", e.order.number)}</div>
        </div>
      </div>
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
              <td className="py-2 text-right tabular-nums">{l.sellingPriceBdt ? fmtBdt(l.sellingPriceBdt.div(l.quantity).toDecimalPlaces(2)) : "—"}</td>
              <td className="py-2 text-right tabular-nums">{fmtBdt(l.sellingPriceBdt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-3 text-right font-semibold">
              Total (incl. purchase, China costs and shipping to Bangladesh)
            </td>
            <td className="pt-3 text-right text-base font-bold tabular-nums">{fmtBdt(e.grandTotalBdt)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-8 text-xs text-gray-500">
        Prices in Bangladeshi Taka. An upfront payment is required before purchase. Final bill is confirmed on arrival in Bangladesh; local delivery charged separately. This quotation expires on{" "}
        {fmtDay(e.validUntil)}.
      </p>
    </div>
  );
}
