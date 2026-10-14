import "server-only";
import { Text, View } from "@react-pdf/renderer";
import type { Decimal } from "@/lib/money";
import { Doc, ItemsTable, Letterhead, Notes, Parties, PaymentBox, Totals, bdt, day, s, type Account, type Item, type Org, type TotalRow } from "./components";

/** What every template gets from getDocumentBranding(). */
export type Brand = { org: Org; logo: Buffer | null; accounts: Account[] };
export type Customer = { name: string; code?: string; phone?: string; address?: string };

/** Invoices (Ship for Me now; Buy for Me final invoice uses the same template). */
export function InvoicePdf(p: {
  brand: Brand;
  number: string;
  date: Date;
  dueDate: Date | null;
  customer: Customer;
  refs: [string, string][];
  items: Item[];
  subtotal: Decimal;
  discount?: Decimal | null;
  total: Decimal;
  paid: Decimal;
  balance: Decimal;
  notes?: string | null;
}) {
  const rows: TotalRow[] = [{ label: "Subtotal", amount: p.subtotal }];
  if (p.discount && !p.discount.isZero()) rows.push({ label: "Discount", amount: p.discount, negative: true });
  rows.push({ label: "Total", amount: p.total, strong: true }, { label: "Amount paid", amount: p.paid, negative: !p.paid.isZero() }, { label: "Balance due", amount: p.balance, strong: true });
  return (
    <Doc title={`Invoice ${p.number}`} org={p.brand.org}>
      <Letterhead org={p.brand.org} logo={p.brand.logo} title="INVOICE" facts={[["Invoice no.", p.number], ["Invoice date", day(p.date)], ["Due date", day(p.dueDate)]]} />
      <Parties customer={p.customer} refs={p.refs} />
      <ItemsTable items={p.items} />
      <Totals rows={rows} />
      {p.balance.isZero() ? <Text style={[s.section, s.bold, { color: "#047857", textAlign: "right" }]}>PAID IN FULL – thank you!</Text> : null}
      <PaymentBox accounts={p.brand.accounts} reference={p.number} />
      <Notes text={p.notes} />
    </Doc>
  );
}

/** "Payment received" receipt for one payment. */
export function ReceiptPdf(p: { brand: Brand; number: string; date: Date; customer: Customer; refs: [string, string][]; amount: Decimal; method: string; reference?: string | null; forWhat: string; totalDue?: Decimal | null; paidToDate?: Decimal | null; balance?: Decimal | null; note?: string | null }) {
  return (
    <Doc title={`Receipt ${p.number}`} org={p.brand.org}>
      <Letterhead org={p.brand.org} logo={p.brand.logo} title="PAYMENT RECEIVED" facts={[["Receipt no.", p.number], ["Date", day(p.date)]]} />
      <Parties customer={p.customer} refs={p.refs} />
      <View style={[s.section, s.box, { alignItems: "center", paddingVertical: 14 }]}>
        <Text style={s.label}>Amount received</Text>
        <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginVertical: 2 }}>{bdt(p.amount)}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>
          {p.method}
          {p.reference ? `  ·  Ref ${p.reference}` : ""}
        </Text>
        <Text style={{ marginTop: 4 }}>for {p.forWhat}</Text>
      </View>
      {p.totalDue ? (
        <Totals
          rows={[
            { label: "Invoice total", amount: p.totalDue },
            { label: "Paid to date (incl. this payment)", amount: p.paidToDate ?? p.amount },
            { label: "Balance due", amount: p.balance ?? "0", strong: true },
          ]}
        />
      ) : null}
      <Notes text={p.note} />
      <Text style={[s.section, s.small, s.muted]}>This receipt confirms we received the payment above. Thank you!</Text>
    </Doc>
  );
}

/** Customer quotation in BDT. */
export function QuotePdf(p: { brand: Brand; number: string; date: Date; validUntil: Date; customer: Customer; refs: [string, string][]; items: Item[]; products: Decimal; shipping?: { label: string; amount: Decimal } | null; delivery?: Decimal | null; estimatedTotal?: Decimal | null; shippingNote: string; terms: string }) {
  const rows: TotalRow[] = [{ label: "Products (incl. China costs)", amount: p.products, strong: !p.shipping }];
  if (p.shipping) {
    rows.push({ label: p.shipping.label, amount: p.shipping.amount });
    if (p.delivery && !p.delivery.isZero()) rows.push({ label: "Home delivery", amount: p.delivery });
    if (p.estimatedTotal) rows.push({ label: "Estimated total", amount: p.estimatedTotal, strong: true });
  }
  return (
    <Doc title={`Quotation ${p.number}`} org={p.brand.org}>
      <Letterhead org={p.brand.org} logo={p.brand.logo} title="QUOTATION" facts={[["Quotation no.", p.number], ["Date", day(p.date)], ["Valid until", day(p.validUntil)]]} />
      <Parties customer={p.customer} refs={p.refs} />
      <ItemsTable items={p.items} />
      <Totals rows={rows} />
      <View style={[s.section, s.box, { borderColor: "#fcd34d", backgroundColor: "#fffbeb" }]} wrap={false}>
        <Text style={s.small}>{p.shippingNote}</Text>
      </View>
      <Text style={[s.section, s.small, s.muted]}>{p.terms}</Text>
      <PaymentBox accounts={p.brand.accounts} reference={p.refs[0]?.[1]} />
    </Doc>
  );
}
