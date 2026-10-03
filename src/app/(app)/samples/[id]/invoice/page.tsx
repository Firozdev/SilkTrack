import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(app)/estimates/[id]/quote/print-button";
import { fmtDay } from "@/lib/dates";
import { docNo, fmtBdt, humanize } from "@/lib/format";
import { allocate, sum } from "@/lib/money";
import { sampleAmounts } from "@/server/samples";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

// Customer-facing sample invoice in BDT. Use the browser's "Save as PDF".
export default async function SampleInvoice({ params }: PageProps<"/samples/[id]/invoice">) {
  await requireUser();
  const { id } = await params;
  const s = await prisma.sample.findUnique({
    where: { id },
    include: {
      order: { select: { number: true } },
      customer: { select: { name: true, code: true, phone: true, address: true, district: true } },
      lines: true,
      payments: { select: { amountBdt: true, type: true } },
    },
  });
  if (!s || !s.totalBdt || !s.totalRmb) notFound();

  // Show each charge in BDT; split the stored BDT total so the parts add up exactly.
  const charges = [
    { label: "Sample price", rmb: s.productRmb },
    { label: "China domestic shipping", rmb: s.chinaShippingRmb },
    { label: "Shipping to Bangladesh", rmb: s.shippingToBdRmb },
    { label: "Service charge", rmb: s.serviceRmb },
  ].filter((c) => c.rmb && !c.rmb.isZero());
  const parts = allocate(s.totalBdt, charges.map((c) => c.rmb!));
  const paid = sum(s.payments.map((p) => (p.type === "REFUND" ? p.amountBdt.neg() : p.amountBdt)));
  const amt = sampleAmounts(s, paid);
  const c = s.customer;

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
          <div className="text-lg font-semibold">SAMPLE INVOICE</div>
          <div>{docNo("sample", s.number)}</div>
          {s.order && <div className="text-xs text-gray-500">Order {docNo("order", s.order.number)}</div>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-gray-500">Bill to</div>
          <div className="font-medium">
            {c.name} ({c.code})
          </div>
          <div>{c.phone}</div>
          <div>{[c.address, c.district].filter(Boolean).join(", ")}</div>
        </div>
        <div className="text-right">
          <div>Date: {fmtDay(s.invoicedAt ?? s.updatedAt)}</div>
          {s.shippingMode && <div>Delivery: {humanize(s.shippingMode)}</div>}
        </div>
      </div>
      <div className="mt-6">
        <div className="text-xs uppercase text-gray-500">Sample of</div>
        <ul className="mt-1 list-disc pl-5">
          {s.lines.map((l) => (
            <li key={l.id}>
              {l.productName} {l.variant} × {l.quantity}
            </li>
          ))}
        </ul>
      </div>
      <table className="mt-6 w-full border-collapse">
        <tbody>
          {charges.map(({ label }, i) => (
            <tr key={label} className="border-b border-gray-100">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right tabular-nums">{fmtBdt(parts[i])}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-3 font-semibold">Total</td>
            <td className="pt-3 text-right text-base font-bold tabular-nums">{fmtBdt(s.totalBdt)}</td>
          </tr>
          {amt.onDelivery.gt(0) && (
            <>
              <tr>
                <td className="pt-3 text-gray-600">Payable before purchase (product)</td>
                <td className="pt-3 text-right tabular-nums">{fmtBdt(amt.beforePurchase)}</td>
              </tr>
              <tr>
                <td className="pt-1 text-gray-600">Payable on delivery (shipping)</td>
                <td className="pt-1 text-right tabular-nums">{fmtBdt(amt.onDelivery)}</td>
              </tr>
            </>
          )}
          {paid.gt(0) && (
            <>
              <tr>
                <td className="pt-3 text-gray-600">Paid</td>
                <td className="pt-3 text-right tabular-nums">−{fmtBdt(paid)}</td>
              </tr>
              <tr>
                <td className="pt-1 font-semibold">Balance due</td>
                <td className="pt-1 text-right font-semibold tabular-nums">{fmtBdt(amt.balance)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <p className="mt-8 text-xs text-gray-500">
        {s.paymentRequired ? `Please pay ${fmtBdt(amt.beforePurchase)} before we purchase the sample${amt.onDelivery.gt(0) ? "; shipping is paid on delivery" : ""}. ` : ""}
        Payment by bKash, Nagad or bank transfer. Please quote {docNo("sample", s.number)} as the reference.
      </p>
    </div>
  );
}
