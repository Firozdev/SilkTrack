import "server-only";
import type { Prisma, ShippingMethod } from "@/generated/prisma/client";
import { D, money, sum, type Decimal } from "@/lib/money";
import { rateCard } from "./shipping-rates";

/**
 * What the customer sees on a quotation. The selling price CS enters per line
 * is the PRODUCT price (unit = line ÷ qty); shipping is estimated separately
 * from China's estimated weight / CBM × the Admin shipping rate that was live
 * when the quote was sent, plus home delivery. Shipping is only an estimate –
 * the final shipping is billed on the lot's actual weight / CBM.
 */
export type QuoteForCustomer = {
  shippingMethod: ShippingMethod;
  grossWeightKg: Prisma.Decimal;
  cbm: Prisma.Decimal;
  sentAt: Date | null;
  lines: { id: string; productName: string; quantity: number; sellingPriceBdt: Prisma.Decimal | null }[];
};

export async function quoteBreakdown(q: QuoteForCustomer) {
  const card = await rateCard(q.sentAt ?? new Date());
  const lines = q.lines.map((l) => ({
    id: l.id,
    productName: l.productName,
    quantity: l.quantity,
    amount: l.sellingPriceBdt ? D(l.sellingPriceBdt) : null,
    unitPrice: l.sellingPriceBdt && l.quantity > 0 ? money(D(l.sellingPriceBdt).div(l.quantity)) : null,
  }));
  const products = money(sum(lines.map((l) => l.amount)));
  const air = q.shippingMethod === "AIR";
  const rate = D(air ? card.airPerKgBdt : card.seaPerCbmBdt);
  const basis = air ? D(q.grossWeightKg) : D(q.cbm);
  const shipping: { basis: Decimal; unit: "kg" | "CBM"; rate: Decimal; amount: Decimal } | null =
    rate.gt(0) && basis.gt(0) ? { basis, unit: air ? "kg" : "CBM", rate, amount: money(basis.mul(rate)) } : null;
  const delivery = D(card.localDeliveryBdt);
  const estimatedTotal = money(products.add(shipping?.amount ?? 0).add(shipping ? delivery : 0));
  return { lines, products, shipping, delivery: shipping ? delivery : D(0), estimatedTotal };
}

export type QuoteBreakdown = Awaited<ReturnType<typeof quoteBreakdown>>;
