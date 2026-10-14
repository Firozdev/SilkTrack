import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action";
import { D, money, sum, type Decimal } from "@/lib/money";
import { docNo } from "@/lib/format";
import { toYmd } from "@/lib/dates";
import { readAttachment, saveLogo } from "@/lib/uploads";
import { CUSTOM_LIMITS, customInvoiceSchema, type CustomInvoiceData, type CustomInvoiceInput } from "@/lib/custom-invoice";
import type { Item } from "@/lib/pdf/components";
import { InvoicePdf } from "@/lib/pdf/documents";
import { requireOwner, type PortalLogin } from "./portal-access";
import { renderPdf } from "./documents";

/**
 * "Create my own version": a customer's (or agent's) copy of one of our
 * invoices to give to THEIR customer. Stored only in CustomInvoice, private to
 * the login that made it. Nothing here writes to the shipping order, our
 * invoice, payments or our generated PDFs.
 */

/** The source must be one of this login's invoiced Ship for Me orders. */
async function invoicedSource(acc: PortalLogin, shippingOrderId: string) {
  await requireOwner(acc, "shipping", shippingOrderId);
  const so = await prisma.shippingOrder.findUnique({ where: { id: shippingOrderId }, include: { items: { orderBy: { lineNo: "asc" }, select: { productName: true, quantity: true } } } });
  if (!so?.invoicedAt || !so.invoiceTotalBdt) throw new UserError("This order has no invoice yet");
  return so;
}

/** Starting point: our invoice's lines, charges and discount; their own business / customer left for them to fill. */
export async function prefillVersion(acc: PortalLogin, shippingOrderId: string): Promise<CustomInvoiceData> {
  const so = await invoicedSource(acc, shippingOrderId);
  const air = so.shippingMethod === "AIR";
  const str = (v: Decimal | Prisma.Decimal | null) => (v ? D(v).toFixed(2) : "0");
  const charges = [
    ["QA test at China warehouse", so.qaFeeBdt],
    ["Home delivery in Bangladesh", so.localDeliveryBdt],
    ["Other charges", so.otherChargeBdt],
  ]
    .filter(([, v]) => v && !D(v as Decimal).isZero())
    .map(([label, v]) => ({ label: label as string, amount: str(v as Decimal) }));
  const count = await prisma.customInvoice.count({ where: { accountId: acc.id, shippingOrderId } });
  return {
    label: `Version ${count + 1}`,
    business: { name: "", phone: "", email: "", address: "" },
    invoiceNo: "",
    invoiceDate: toYmd(new Date()),
    dueDate: "",
    billTo: { name: "", phone: "", address: "" },
    items: [
      {
        description: `${air ? "Air" : "Sea"} freight China to Bangladesh – ${so.items.map((i) => `${i.productName} × ${i.quantity}`).join(", ")}`.slice(0, CUSTOM_LIMITS.text),
        qty: D(air ? so.billWeightKg : so.billCbm).toString(),
        unitPrice: str(air ? so.shipRatePerKgBdt : so.shipRatePerCbmBdt),
      },
    ],
    charges,
    discount: str(so.discountBdt),
    paid: "0",
    notes: "",
    accounts: [],
  };
}

/** Server-side totals (the browser's are only a preview). */
export function customTotals(d: CustomInvoiceData) {
  const lines = d.items.map((i) => money(D(i.qty).mul(D(i.unitPrice))));
  const charges = d.charges.map((c) => money(D(c.amount)));
  const subtotal = sum([...lines, ...charges]);
  const discount = money(D(d.discount));
  if (discount.gt(subtotal)) throw new UserError("The discount can't be more than the subtotal");
  const total = subtotal.sub(discount);
  const paid = money(D(d.paid));
  const balance = total.sub(paid);
  return { lines, subtotal, discount, total, paid, balance: balance.isNeg() ? D(0) : balance };
}

function parse(input: CustomInvoiceInput) {
  const r = customInvoiceSchema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Check the form");
  customTotals(r.data); // also checks the discount
  return r.data;
}

async function logoFields(logo: File | null | undefined) {
  if (!logo || logo.size === 0) return undefined;
  const l = await saveLogo(logo, { allowSvg: false });
  return { logoKey: l.key, logoMime: l.mime };
}

export async function createVersion(acc: PortalLogin, shippingOrderId: string, input: CustomInvoiceInput, logo?: File | null) {
  await invoicedSource(acc, shippingOrderId);
  if ((await prisma.customInvoice.count({ where: { accountId: acc.id, shippingOrderId } })) >= CUSTOM_LIMITS.versionsPerOrder) {
    throw new UserError(`You can keep up to ${CUSTOM_LIMITS.versionsPerOrder} versions per order`);
  }
  const data = parse(input);
  return prisma.customInvoice.create({ data: { accountId: acc.id, shippingOrderId, label: data.label, data: data as unknown as Prisma.InputJsonObject, ...(await logoFields(logo)) } });
}

/** Only the login that made a version can see or change it. */
export async function getVersion(acc: PortalLogin, id: string) {
  const v = await prisma.customInvoice.findFirst({ where: { id, accountId: acc.id } });
  if (!v) return null;
  // Access to the source order may have ended (e.g. an agent's customer was reassigned).
  try {
    await requireOwner(acc, "shipping", v.shippingOrderId);
  } catch {
    return null;
  }
  return { ...v, data: customInvoiceSchema.parse(v.data) };
}

export async function updateVersion(acc: PortalLogin, id: string, input: CustomInvoiceInput, opts: { logo?: File | null; removeLogo?: boolean } = {}) {
  const v = await getVersion(acc, id);
  if (!v) throw new UserError("Not found");
  const data = parse(input);
  const logo = await logoFields(opts.logo);
  return prisma.customInvoice.update({
    where: { id },
    data: { label: data.label, data: data as unknown as Prisma.InputJsonObject, ...(logo ?? (opts.removeLogo ? { logoKey: null, logoMime: null } : {})) },
  });
}

export function listVersions(acc: PortalLogin, shippingOrderId: string) {
  return prisma.customInvoice.findMany({ where: { accountId: acc.id, shippingOrderId }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, updatedAt: true } });
}

export async function versionLogo(acc: PortalLogin, id: string) {
  const v = await getVersion(acc, id);
  if (!v?.logoKey) return null;
  return { body: await readAttachment(v.logoKey), mime: v.logoMime ?? "image/png" };
}

const ymdDate = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

/** Their PDF: same invoice template, their business everywhere – none of ours. */
export async function versionPdf(acc: PortalLogin, id: string) {
  const v = await getVersion(acc, id);
  if (!v) return null;
  const d = v.data;
  const t = customTotals(d);
  const so = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: v.shippingOrderId }, select: { number: true } });
  const items: Item[] = [...d.items.map((i, n) => ({ description: i.description, qty: i.qty, unitPrice: D(i.unitPrice), amount: t.lines[n] })), ...d.charges.map((c) => ({ description: c.label, amount: money(D(c.amount)) }))];
  const logo = v.logoKey ? await readAttachment(v.logoKey).catch(() => null) : null;
  const brand = {
    org: { name: d.business.name, tagline: "", phone: d.business.phone, email: d.business.email, website: "", address: d.business.address },
    logo,
    accounts: d.accounts.map((a, n) => ({ id: String(n), type: null, providerName: a.provider, accountName: a.accountName, accountNumber: a.accountNumber, branch: null, routingNumber: null, notes: a.notes || null })),
  };
  const number = d.invoiceNo || "—";
  const make = (b: typeof brand) => (
    <InvoicePdf
      brand={b}
      number={number}
      date={ymdDate(d.invoiceDate) ?? new Date()}
      dueDate={ymdDate(d.dueDate)}
      customer={{ name: d.billTo.name || "—", phone: d.billTo.phone || undefined, address: d.billTo.address || undefined }}
      refs={[]}
      items={items}
      subtotal={t.subtotal}
      discount={t.discount}
      total={t.total}
      paid={t.paid}
      balance={t.balance}
      notes={d.notes}
    />
  );
  let pdf: Buffer;
  try {
    pdf = Buffer.from(await renderPdf(make(brand)));
  } catch (err) {
    if (!logo) throw err;
    pdf = Buffer.from(await renderPdf(make({ ...brand, logo: null }))); // a logo that breaks rendering is left out
  }
  const safe = (d.invoiceNo || v.label || "invoice").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60);
  return { pdf, fileName: `${safe}.pdf`, sourceRef: docNo("shippingOrder", so.number) };
}
