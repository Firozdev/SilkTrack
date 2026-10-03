import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { diffFields, logChanges } from "@/lib/audit";
import { BD_TZ, dayFromYmd, today } from "@/lib/dates";
import type { Actor } from "./actor";

/**
 * The rate in force today (Bangladesh calendar day). If none was entered for
 * today, the latest earlier rate is returned with isToday = false.
 */
export async function getCurrentRate(now = new Date()) {
  const day = today(BD_TZ, now);
  const rate = await prisma.exchangeRate.findFirst({
    where: { effectiveDate: { lte: day } },
    orderBy: { effectiveDate: "desc" },
  });
  return { rate, isToday: !!rate && rate.effectiveDate.getTime() === day.getTime() };
}

/** Rate to lock onto a purchase / estimate / invoice. Throws if none exists at all. */
export async function rateForConversion(now = new Date()) {
  const { rate } = await getCurrentRate(now);
  if (!rate) throw new UserError("No exchange rate has been entered yet. Ask Admin to add today's RMB→BDT rate.");
  return { exchangeRateId: rate.id, rateUsed: rate.rate };
}

export type RateInput = {
  date: string; // YYYY-MM-DD
  rate: string;
  buyingRate?: string;
  sellingRate?: string;
  note?: string;
};

/** Add or edit the rate for a day. Admin only; every change is audit-logged. */
export async function saveRate(actor: Actor, input: RateInput) {
  assertCan(actor.role, "rate:edit");
  if (Number(input.rate) <= 0) throw new UserError("Rate must be greater than zero");
  const effectiveDate = dayFromYmd(input.date);
  const data = {
    rate: input.rate,
    buyingRate: input.buyingRate ?? null,
    sellingRate: input.sellingRate ?? null,
    note: input.note ?? null,
    updatedById: actor.id,
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.exchangeRate.findUnique({ where: { effectiveDate } });
    if (!existing) {
      const created = await tx.exchangeRate.create({ data: { ...data, effectiveDate } });
      await logChanges(tx, {
        entityType: "ExchangeRate",
        entityId: created.id,
        userId: actor.id,
        action: "UPDATE",
        changes: diffFields({}, { rate: created.rate, buyingRate: created.buyingRate, sellingRate: created.sellingRate }),
      });
      return created;
    }
    const updated = await tx.exchangeRate.update({ where: { id: existing.id }, data });
    await logChanges(tx, {
      entityType: "ExchangeRate",
      entityId: existing.id,
      userId: actor.id,
      action: "UPDATE",
      changes: diffFields(existing, { rate: updated.rate, buyingRate: updated.buyingRate, sellingRate: updated.sellingRate }),
    });
    return updated;
  });
}

export function listRates(take = 120) {
  return prisma.exchangeRate.findMany({
    orderBy: { effectiveDate: "desc" },
    take,
    include: { updatedBy: { select: { name: true } } },
  });
}
