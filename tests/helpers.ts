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
export const DONE = { trackingUrl: "https://trade.1688.com/order/123", expectedArrivalAt: new Date("2026-10-08T00:00:00Z") };

/**
 * Take a request through the China quotation to customer approval:
 * send to China → China quotes and submits → BD sets selling prices → sent → approved.
 */
export async function quoteAndApprove(orderId: string, unitPriceRmb = "10", sellingPerLine = "1000", size: { cartonCount?: number; lengthCm?: string; widthCm?: string; heightCm?: string; unitWeightKg?: string } = {}) {
  const { saveQuotation, submitQuotation, setSellingPrices, sendQuotationToCustomer, approveQuotation } = await import("@/server/estimates");
  const { sendToChina } = await import("@/server/requests");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  const china = (await prisma.user.findFirst({ where: { role: "PURCHASE" } })) ?? (await makeUser("PURCHASE"));
  const bd = (await prisma.user.findFirst({ where: { role: "CS" } })) ?? (await makeUser("CS"));
  if (order.requestStatus === "NEW") await sendToChina(bd, orderId);
  const e = await saveQuotation(china, orderId, {
    shippingMethod: order.shippingMethod,
    shippingRatePerKgRmb: "10",
    shippingRatePerCbmRmb: "1000",
    validUntil: new Date("2099-01-01T00:00:00Z"),
    lines: order.lines.map((l) => ({ orderLineId: l.id, unitPriceRmb, unitWeightKg: "0.5", ...size })),
  });
  await submitQuotation(china, e.id);
  const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
  await setSellingPrices(bd, e.id, lines.map((l) => ({ lineId: l.id, sellingPriceBdt: sellingPerLine })));
  await sendQuotationToCustomer(bd, e.id);
  await approveQuotation(bd, e.id);
  return e;
}
