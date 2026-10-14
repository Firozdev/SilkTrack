import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { DocumentKind, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { D, sum } from "@/lib/money";
import { docNo, humanize } from "@/lib/format";
import { readAttachment, saveGeneratedPdf } from "@/lib/uploads";
import type { Item } from "@/lib/pdf/components";
import { InvoicePdf, QuotePdf, ReceiptPdf, type Brand, type Customer } from "@/lib/pdf/documents";
import { getDocumentBranding } from "./organization";
import { quoteBreakdown } from "./quote-breakdown";
import { getQuotation } from "./estimates";

/**
 * Generated PDFs: invoices, quotations and "payment received" receipts, all
 * from the shared templates in src/lib/pdf and the organization / payment
 * details in Settings. Every (re)generation is stored as a new version.
 */

async function brand(): Promise<Brand> {
  const b = await getDocumentBranding();
  // PDFs can embed PNG / JPG only; an SVG logo is left out (Settings warns about it).
  const logo = b.org.logo && b.org.logo.mime !== "image/svg+xml" ? await readAttachment(b.org.logo.key).catch(() => null) : null;
  return { org: b.org, logo, accounts: b.accounts };
}

type Link = { shippingOrderId?: string; invoiceId?: string; estimateId?: string; paymentId?: string };

const RENDER_TIMEOUT_MS = 15_000;

function render(element: ReactElement) {
  return Promise.race([
    renderToBuffer(element as Parameters<typeof renderToBuffer>[0]),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PDF rendering timed out")), RENDER_TIMEOUT_MS).unref()),
  ]);
}

/** Render with the logo; if the logo breaks rendering (damaged file), render again without it. */
async function renderWithFallback(make: (b: Brand) => ReactElement) {
  const b = await brand();
  try {
    return await render(make(b));
  } catch (err) {
    if (!b.logo) throw err;
    console.error("PDF rendering failed with the logo – retrying without it", err);
    return render(make({ ...b, logo: null }));
  }
}

async function store(kind: DocumentKind, number: string, link: Link, make: (b: Brand) => ReactElement, actorId: string | null) {
  const pdf = await renderWithFallback(make);
  const storageKey = await saveGeneratedPdf(Buffer.from(pdf), number);
  const version = (await prisma.generatedDocument.count({ where: { kind, ...link } })) + 1;
  return prisma.generatedDocument.create({ data: { kind, number, version, storageKey, fileName: `${number}${version > 1 ? `-v${version}` : ""}.pdf`, createdById: actorId, ...link } });
}

const address = (c: { address: string; district?: string | null; area?: string | null }) => [c.address, c.area, c.district].filter(Boolean).join(", ");
const customerOf = (c: { name: string; code: string; phone: string; address: string; district?: string | null; area?: string | null }): Customer => ({ name: c.name, code: c.code, phone: c.phone, address: address(c) });

export const shippingInvoiceNo = (n: number) => `INV-${docNo("shippingOrder", n)}`;
export const receiptNo = (n: number) => `RCT-${String(n).padStart(6, "0")}`;

async function shippingPaid(shippingOrderId: string) {
  const rows = await prisma.payment.findMany({ where: { shippingOrderId }, select: { type: true, amountBdt: true } });
  return sum(rows.map((r) => (r.type === "REFUND" ? D(r.amountBdt).neg() : D(r.amountBdt))));
}

/** Ship for Me invoice PDF – after the invoice is saved or revised, and after each payment. */
export async function generateShippingInvoice(shippingOrderId: string, actorId: string | null) {
  const so = await prisma.shippingOrder.findUnique({ where: { id: shippingOrderId }, include: { customer: true, shipment: { select: { code: true } }, items: { orderBy: { lineNo: "asc" }, select: { productName: true, quantity: true } } } });
  if (!so?.invoicedAt || !so.invoiceTotalBdt) return null;
  const invoicedAt = so.invoicedAt;
  const air = so.shippingMethod === "AIR";
  const basis = air ? so.billWeightKg : so.billCbm;
  const items: Item[] = [
    {
      description: `${air ? "Air" : "Sea"} freight China to Bangladesh`,
      detail: so.items.map((i) => `${i.productName} × ${i.quantity}`).join(", "),
      qty: `${D(basis).toString()} ${air ? "kg" : "CBM"}`,
      unitPrice: air ? so.shipRatePerKgBdt : so.shipRatePerCbmBdt,
      amount: D(so.shippingChargeBdt),
    },
  ];
  if (so.qaFeeBdt && !D(so.qaFeeBdt).isZero()) items.push({ description: "QA test at China warehouse", amount: so.qaFeeBdt });
  if (so.localDeliveryBdt && !D(so.localDeliveryBdt).isZero()) items.push({ description: "Home delivery in Bangladesh", amount: so.localDeliveryBdt });
  if (so.otherChargeBdt && !D(so.otherChargeBdt).isZero()) items.push({ description: "Other charges", amount: so.otherChargeBdt });
  const subtotal = sum(items.map((i) => D(i.amount)));
  const total = D(so.invoiceTotalBdt);
  const paid = await shippingPaid(so.id);
  const balance = total.sub(paid).isNeg() ? D(0) : total.sub(paid);
  const number = shippingInvoiceNo(so.number);
  const element = (b: Brand) => (
    <InvoicePdf
      brand={b}
      number={number}
      date={invoicedAt}
      dueDate={so.invoiceDueDate}
      customer={customerOf(so.customer)}
      refs={[["Order", docNo("shippingOrder", so.number)], ...(so.shipment ? ([["Shipment", so.shipment.code]] as [string, string][]) : []), ["Shipping by", air ? "Air" : "Sea"]]}
      items={items}
      subtotal={subtotal}
      discount={so.discountBdt ? D(so.discountBdt) : null}
      total={total}
      paid={paid}
      balance={balance}
      notes={so.invoiceNotes}
    />
  );
  return store("SHIPPING_INVOICE", number, { shippingOrderId: so.id }, element, actorId);
}

/** "Payment received" receipt for one payment (Ship for Me or Buy for Me). */
export async function generateReceipt(paymentId: string, actorId: string | null) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { customer: true } }, shippingOrder: { include: { customer: true, shipment: { select: { code: true } } } } },
  });
  if (!p || p.type === "REFUND" || (!p.order && !p.shippingOrder)) return null;
  const number = receiptNo(p.number);
  const so = p.shippingOrder;
  let totals: { totalDue: Prisma.Decimal; paidToDate: Prisma.Decimal; balance: Prisma.Decimal } | null = null;
  if (so?.invoiceTotalBdt) {
    const rows = await prisma.payment.findMany({ where: { shippingOrderId: so.id, paidAt: { lte: p.paidAt }, createdAt: { lte: p.createdAt } }, select: { type: true, amountBdt: true } });
    const paidToDate = sum(rows.map((r) => (r.type === "REFUND" ? D(r.amountBdt).neg() : D(r.amountBdt))));
    const bal = D(so.invoiceTotalBdt).sub(paidToDate);
    totals = { totalDue: D(so.invoiceTotalBdt), paidToDate, balance: bal.isNeg() ? D(0) : bal };
  }
  const ref = so ? docNo("shippingOrder", so.number) : docNo("order", p.order!.number);
  const element = (b: Brand) => (
    <ReceiptPdf
      brand={b}
      number={number}
      date={p.paidAt}
      customer={customerOf((so ?? p.order)!.customer)}
      refs={[[so ? "Order" : "Request", ref], ...(so ? ([["Invoice", shippingInvoiceNo(so.number)]] as [string, string][]) : []), ...(so?.shipment ? ([["Shipment", so.shipment.code]] as [string, string][]) : [])]}
      amount={D(p.amountBdt)}
      method={p.method === "BKASH" ? "bKash" : humanize(p.method)}
      reference={p.reference}
      forWhat={so ? `shipping service ${ref}` : `${humanize(p.type).toLowerCase()} payment for ${ref}`}
      {...(totals ?? {})}
      note={p.note}
    />
  );
  return store("PAYMENT_RECEIPT", number, { paymentId: p.id }, element, actorId);
}

/** Customer quotation PDF (BDT) – when sent to the customer, or on download. */
export async function generateQuotePdf(estimateId: string, actorId: string | null) {
  const e = await getQuotation(estimateId);
  if (!e?.grandTotalBdt) return null;
  const qb = await quoteBreakdown(e);
  const number = `${docNo("estimate", e.number)} v${e.version}`;
  const air = e.shippingMethod === "AIR";
  const element = (b: Brand) => (
    <QuotePdf
      brand={b}
      number={number}
      date={e.sentAt ?? e.updatedAt}
      validUntil={e.validUntil}
      customer={{ name: e.order.customer.name, code: e.order.customer.code, phone: e.order.customer.phone, address: address(e.order.customer) }}
      refs={[["Request", docNo("order", e.order.number)], ["Shipping by", air ? "Air" : "Sea"]]}
      items={e.lines.map((l, i) => ({ description: l.productName, detail: [l.orderLine?.color, l.orderLine?.size, l.orderLine?.model].filter(Boolean).join(" · ") || undefined, qty: String(l.quantity), unitPrice: qb.lines[i].unitPrice, amount: D(l.sellingPriceBdt) }))}
      products={qb.products}
      shipping={qb.shipping ? { label: `Estimated shipping (${air ? "air" : "sea"}: ${qb.shipping.basis.toString()} ${qb.shipping.unit} × ${qb.shipping.rate.toFixed(2)})`, amount: qb.shipping.amount } : null}
      delivery={qb.delivery}
      estimatedTotal={qb.shipping ? qb.estimatedTotal : null}
      shippingNote={`${qb.shipping ? "Shipping is an estimate from the expected weight / CBM. It can change depending on your lot – the actual weight and size when it reaches our China warehouse." : "Shipping is added later, based on the actual weight / CBM of your lot."} The final shipping is billed when your goods arrive in Bangladesh.`}
      terms="Prices in Bangladeshi Taka (BDT). An upfront payment for the products is required before purchase."
    />
  );
  return store("QUOTE", number.replace(" ", "-"), { estimateId: e.id }, element, actorId);
}

/** Run a generation without ever breaking the action that triggered it (download regenerates if missing). */
export async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`PDF ${label} failed`, err);
  }
}

export function latestDocument(kind: DocumentKind, link: Link) {
  return prisma.generatedDocument.findFirst({ where: { kind, ...link }, orderBy: { version: "desc" } });
}

export function documentVersions(kind: DocumentKind, link: Link) {
  return prisma.generatedDocument.findMany({ where: { kind, ...link }, orderBy: { version: "desc" }, include: { createdBy: { select: { name: true } } } });
}
