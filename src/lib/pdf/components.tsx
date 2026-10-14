import "server-only";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { Decimal } from "@/lib/money";

/**
 * Shared building blocks for every PDF (invoices, quotations, receipts).
 * Organization and payment details always come in as `Letterhead` / `PaymentBox`
 * props from getDocumentBranding() – nothing about the business is written here.
 */

const BLUE = "#1d4ed8";
const GREY = "#6b7280";
const LINE = "#e5e7eb";

export const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#111827", lineHeight: 1.35 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: GREY },
  small: { fontSize: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BLUE, lineHeight: 1.15, marginBottom: 2 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right", letterSpacing: 1, lineHeight: 1.15, marginBottom: 4 },
  label: { fontSize: 7.5, color: GREY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  section: { marginTop: 14 },
  box: { borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 8 },
});

/** BDT 12,345.00 (Helvetica has no ৳ sign). Negative amounts get a minus. */
export function bdt(v: Decimal | number | string | null | undefined) {
  const n = Number(v ?? 0);
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}BDT ${abs}`;
}

export const day = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d) : "—");

export type Org = { name: string; tagline: string; phone: string; email: string; website: string; address: string };

/** A4 document with a footer (organization name + page x of y). */
export function Doc({ title, org, children }: { title: string; org: Org; children: ReactNode }) {
  return (
    <Document title={title} author={org.name || undefined} creator={org.name || undefined} producer={org.name || undefined}>
      <Page size="A4" style={s.page}>
        {children}
        <View fixed style={{ position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 }}>
          <Text style={[s.small, s.muted]}>{[org.name, org.phone, org.email, org.website].filter(Boolean).join("  ·  ")}</Text>
          <Text style={[s.small, s.muted]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Logo + organization on the left, document title and key facts on the right. */
export function Letterhead({ org, logo, title, facts }: { org: Org; logo: Buffer | null; title: string; facts: [string, string][] }) {
  return (
    <View style={[s.between, { borderBottomWidth: 2, borderBottomColor: BLUE, paddingBottom: 10 }]}>
      <View style={[s.row, { maxWidth: "60%" }]}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt attribute */}
        {logo && <Image src={logo} style={{ maxHeight: 48, maxWidth: 110, marginRight: 10, objectFit: "contain" }} />}
        <View>
          {org.name ? <Text style={s.h1}>{org.name}</Text> : null}
          {org.tagline ? <Text style={[s.small, s.muted]}>{org.tagline}</Text> : null}
          {org.address ? <Text style={[s.small, { marginTop: 3 }]}>{org.address}</Text> : null}
          {[org.phone, org.email, org.website].some(Boolean) ? <Text style={s.small}>{[org.phone, org.email, org.website].filter(Boolean).join("  ·  ")}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.title}>{title}</Text>
        {facts.map(([k, v]) => (
          <Text key={k} style={{ textAlign: "right", marginTop: 2 }}>
            <Text style={s.muted}>{k}: </Text>
            <Text style={s.bold}>{v}</Text>
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Customer block (left) and references (right). */
export function Parties({ customer, refs }: { customer: { name: string; code?: string; phone?: string; address?: string }; refs: [string, string][] }) {
  return (
    <View style={[s.between, s.section]}>
      <View style={{ width: "55%" }}>
        <Text style={s.label}>Bill to</Text>
        <Text style={s.bold}>
          {customer.name}
          {customer.code ? ` (${customer.code})` : ""}
        </Text>
        {customer.phone ? <Text>{customer.phone}</Text> : null}
        {customer.address ? <Text>{customer.address}</Text> : null}
      </View>
      <View style={{ width: "40%" }}>
        {refs.length > 0 && <Text style={s.label}>Reference</Text>}
        {refs.map(([k, v]) => (
          <View key={k} style={s.between}>
            <Text style={s.muted}>{k}</Text>
            <Text>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export type Item = { description: string; detail?: string; qty?: string; unitPrice?: Decimal | string | null; amount: Decimal | string };

const COL = { n: "6%", d: "50%", q: "12%", u: "16%", a: "16%" } as const;

export function ItemsTable({ items }: { items: Item[] }) {
  const th = { ...s.label, marginBottom: 0 };
  return (
    <View style={s.section}>
      <View style={[s.row, { borderBottomWidth: 1, borderBottomColor: "#9ca3af", paddingBottom: 4 }]}>
        <Text style={[th, { width: COL.n }]}>#</Text>
        <Text style={[th, { width: COL.d }]}>Description</Text>
        <Text style={[th, { width: COL.q, textAlign: "right" }]}>Qty</Text>
        <Text style={[th, { width: COL.u, textAlign: "right" }]}>Unit price</Text>
        <Text style={[th, { width: COL.a, textAlign: "right" }]}>Amount</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} wrap={false} style={[s.row, { borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 }]}>
          <Text style={{ width: COL.n }}>{i + 1}</Text>
          <View style={{ width: COL.d, paddingRight: 6 }}>
            <Text>{it.description}</Text>
            {it.detail ? <Text style={[s.small, s.muted]}>{it.detail}</Text> : null}
          </View>
          <Text style={{ width: COL.q, textAlign: "right" }}>{it.qty ?? "1"}</Text>
          <Text style={{ width: COL.u, textAlign: "right" }}>{it.unitPrice !== undefined && it.unitPrice !== null ? bdt(it.unitPrice) : bdt(it.amount)}</Text>
          <Text style={{ width: COL.a, textAlign: "right" }}>{bdt(it.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

export type TotalRow = { label: string; amount: Decimal | string; strong?: boolean; negative?: boolean };

export function Totals({ rows }: { rows: TotalRow[] }) {
  return (
    <View style={{ marginTop: 8, marginLeft: "auto", width: "45%" }} wrap={false}>
      {rows.map((r) => (
        <View key={r.label} style={[s.between, { paddingVertical: 2 }, r.strong ? { borderTopWidth: 1, borderTopColor: "#9ca3af", marginTop: 2, paddingTop: 4 } : {}]}>
          <Text style={r.strong ? s.bold : s.muted}>{r.label}</Text>
          <Text style={r.strong ? [s.bold, { fontSize: 11 }] : {}}>{r.negative ? `-${bdt(r.amount)}` : bdt(r.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

export type Account = { id: string; /** null: no type label (customer-made versions). */ type: "BANK" | "MOBILE_BANKING" | "OTHER" | null; providerName: string; accountName: string; accountNumber: string; branch: string | null; routingNumber: string | null; notes: string | null };
const TYPE = { BANK: "Bank", MOBILE_BANKING: "Mobile banking", OTHER: "Other" } as const;

/** Accounts marked "Show on PDFs" (in Admin's order); nothing when there are none. */
export function PaymentBox({ accounts, reference }: { accounts: Account[]; reference?: string }) {
  if (!accounts.length) return null;
  return (
    <View style={[s.section, s.box]} wrap={false}>
      <Text style={s.label}>How to pay</Text>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {accounts.map((a) => (
          <View key={a.id} style={{ width: "50%", paddingRight: 8, marginTop: 4 }}>
            <Text style={s.bold}>
              {a.providerName} {a.type ? <Text style={[s.muted, { fontFamily: "Helvetica" }]}>({TYPE[a.type]})</Text> : null}
            </Text>
            <Text>Account name: {a.accountName}</Text>
            <Text>Account no.: {a.accountNumber}</Text>
            {a.branch ? <Text>Branch: {a.branch}</Text> : null}
            {a.routingNumber ? <Text>Routing no.: {a.routingNumber}</Text> : null}
            {a.notes ? <Text style={[s.small, s.muted]}>{a.notes}</Text> : null}
          </View>
        ))}
      </View>
      {reference ? <Text style={[s.small, { marginTop: 6 }]}>Please use {reference} as the payment reference.</Text> : null}
    </View>
  );
}

export function Notes({ title = "Notes", text }: { title?: string; text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.label}>{title}</Text>
      <Text>{text.trim()}</Text>
    </View>
  );
}
