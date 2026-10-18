import { prisma } from "@/lib/prisma";
import { dayFromYmd } from "@/lib/dates";
import type { Role } from "@/generated/prisma/enums";
import type { Actor } from "@/server/actor";

/** Empty every table (keeps the migrations table). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  }
}

let n = 0;
export async function makeUser(role: Role): Promise<Actor> {
  n += 1;
  const u = await prisma.user.create({
    data: { email: `${role.toLowerCase()}${n}@test.local`, name: `${role} ${n}`, role, passwordHash: "x" },
  });
  return { id: u.id, role: u.role };
}

export async function makeRate(ymd: string, rate: string, adminId: string) {
  return prisma.exchangeRate.create({ data: { effectiveDate: dayFromYmd(ymd), rate, updatedById: adminId } });
}

/** Required "purchase complete" details. */
/** Required purchase details; `paidRmb` is the total paid to the supplier (any value > 0 for tests). */
export const DONE = { trackingUrl: "https://trade.1688.com/order/123", expectedArrivalAt: new Date("2026-10-08T00:00:00Z"), paidRmb: "100" };

/**
 * Take a request through the China quotation to customer approval:
 * China quotes → BD sets selling prices → sent → approved (the older BD-priced
 * path, so tests can use round selling prices; China's direct send is tested
 * in quote-direct.test.ts).
 */
/**
 * A quotation waiting at "Submitted by China", as quotations were before China
 * sent them directly – BD then prices and sends it (still supported).
 */
export async function submitAsLegacy(estimateId: string) {
  await prisma.estimate.update({ where: { id: estimateId }, data: { status: "SUBMITTED_BY_CHINA", submittedAt: new Date() } });
}

export async function quoteAndApprove(orderId: string, unitPriceRmb = "10", sellingPerLine = "1000", size: { cartonCount?: number; lengthCm?: string; widthCm?: string; heightCm?: string; unitWeightKg?: string } = {}) {
  const { saveQuotation, setSellingPrices, sendQuotationToCustomer, approveQuotation } = await import("@/server/estimates");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  const china = (await prisma.user.findFirst({ where: { role: "PURCHASE" } })) ?? (await makeUser("PURCHASE"));
  const bd = (await prisma.user.findFirst({ where: { role: "CS" } })) ?? (await makeUser("CS"));
  const e = await saveQuotation(china, orderId, {
    shippingMethod: order.shippingMethod,
    shippingRatePerKgRmb: "10",
    shippingRatePerCbmRmb: "1000",
    validUntil: new Date("2099-01-01T00:00:00Z"),
    lines: order.lines.map((l) => ({ orderLineId: l.id, unitPriceRmb, unitWeightKg: "0.5", ...size })),
  });
  await submitAsLegacy(e.id);
  const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
  await setSellingPrices(bd, e.id, lines.map((l) => ({ lineId: l.id, sellingPriceBdt: sellingPerLine })));
  await sendQuotationToCustomer(bd, e.id);
  await approveQuotation(bd, e.id);
  return e;
}
