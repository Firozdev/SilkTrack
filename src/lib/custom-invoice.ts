import { z } from "zod";

/**
 * A customer's own version of one of our invoices ("Create my own version").
 * Shared by the portal editor (client) and the server, which re-validates and
 * recalculates every total – the browser's numbers are never trusted.
 */
export const CUSTOM_LIMITS = { items: 50, charges: 10, accounts: 6, versionsPerOrder: 10, text: 200, longText: 1000 } as const;

const text = (max: number = CUSTOM_LIMITS.text) => z.string().trim().max(max, `Keep it under ${max} characters`).default("");
/** Up to 12 digits and 2 decimals, not negative. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250 or 1250.50")
  .or(z.literal("").transform(() => "0"));
const qty = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 2 or 4.5");

export const customInvoiceSchema = z.object({
  label: z.string().trim().min(1, "Give this version a name").max(80),
  business: z.object({ name: text(), phone: text(), email: text(), address: text(CUSTOM_LIMITS.longText) }),
  invoiceNo: text(60),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the invoice date"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  billTo: z.object({ name: text(), phone: text(), address: text(CUSTOM_LIMITS.longText) }),
  items: z
    .array(z.object({ description: z.string().trim().min(1, "Every line needs a description").max(CUSTOM_LIMITS.text), qty, unitPrice: amount }))
    .min(1, "Add at least one line")
    .max(CUSTOM_LIMITS.items, `At most ${CUSTOM_LIMITS.items} lines`),
  charges: z.array(z.object({ label: z.string().trim().min(1, "Name each charge").max(80), amount })).max(CUSTOM_LIMITS.charges).default([]),
  discount: amount.default("0"),
  paid: amount.default("0"),
  notes: text(CUSTOM_LIMITS.longText),
  accounts: z
    .array(z.object({ provider: z.string().trim().min(1, "Enter the bank / provider").max(80), accountName: text(120), accountNumber: z.string().trim().min(1, "Enter the account number").max(60), notes: text() }))
    .max(CUSTOM_LIMITS.accounts)
    .default([]),
});

export type CustomInvoiceData = z.infer<typeof customInvoiceSchema>;
export type CustomInvoiceInput = z.input<typeof customInvoiceSchema>;
