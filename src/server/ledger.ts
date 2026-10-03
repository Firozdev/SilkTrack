import "server-only";
import { prisma } from "@/lib/prisma";
import { sum } from "@/lib/money";

/** Customer money summary: issued order invoices + sample invoices vs payments. */
export async function customerLedger(customerId: string) {
  const [invoices, samples, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { order: { customerId }, status: { not: "CANCELLED" }, issuedAt: { not: null } }, select: { totalBdt: true } }),
    prisma.sample.findMany({ where: { customerId, status: { not: "CANCELLED" }, totalBdt: { not: null } }, select: { totalBdt: true } }),
    prisma.payment.findMany({ where: { OR: [{ order: { customerId } }, { sample: { customerId } }] }, select: { type: true, amountBdt: true } }),
  ]);
  const invoiced = sum([...invoices.map((i) => i.totalBdt), ...samples.map((s) => s.totalBdt)]);
  const paid = sum(payments.filter((p) => p.type !== "REFUND").map((p) => p.amountBdt));
  const refunded = sum(payments.filter((p) => p.type === "REFUND").map((p) => p.amountBdt));
  return { invoiced, paid, refunded, balance: invoiced.sub(paid).add(refunded) };
}
