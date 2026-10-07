import "server-only";
import type { ShippingRate } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import type { RateCard } from "@/lib/shipping-estimate";
import type { Actor } from "./actor";

/**
 * Shipping rate card history. A record is never edited: a change is a new
 * record. Live = latest effectiveFrom ≤ now (only one at a time); later ones
 * are Upcoming (can be deleted), earlier ones Previous.
 */

export function liveRate(now = new Date()) {
  return prisma.shippingRate.findFirst({ where: { effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: "desc" } });
}

const str = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : v.toString());

/** Rate card for estimates. No rate yet → empty rates and the default delivery charge. */
export async function rateCardOf(r: ShippingRate | null): Promise<RateCard> {
  if (!r) return { airPerKgBdt: "", seaPerCbmBdt: "", qaFeeBdt: "", localDeliveryBdt: await getSetting("default_local_delivery_bdt") };
  return { airPerKgBdt: str(r.airPerKgBdt), seaPerCbmBdt: str(r.seaPerCbmBdt), qaFeeBdt: str(r.qaFeeBdt), localDeliveryBdt: str(r.localDeliveryBdt) };
}

/** The live rate card (new orders and forms). */
export async function rateCard(now = new Date()) {
  return rateCardOf(await liveRate(now));
}

/** The rate locked on an order, else the live one. */
export async function rateCardFor(shippingRateId: string | null | undefined) {
  const r = shippingRateId ? await prisma.shippingRate.findUnique({ where: { id: shippingRateId } }) : null;
  return r ? rateCardOf(r) : rateCard();
}

export type RateStatus = "UPCOMING" | "LIVE" | "PREVIOUS";

/** All rates, newest first, each with its status and the time it stopped / stops being live. */
export async function listShippingRates(now = new Date()) {
  const rows = await prisma.shippingRate.findMany({ orderBy: { effectiveFrom: "desc" }, include: { createdBy: { select: { name: true } }, _count: { select: { shippingOrders: true } } } });
  const live = rows.find((r) => r.effectiveFrom <= now);
  return rows.map((r, i) => ({
    ...r,
    status: (r.effectiveFrom > now ? "UPCOMING" : r.id === live?.id ? "LIVE" : "PREVIOUS") as RateStatus,
    /** Start of the next record = end of this one. */
    endsAt: i > 0 ? rows[i - 1].effectiveFrom : null,
  }));
}

export type NewRateInput = { airPerKgBdt?: string; seaPerCbmBdt?: string; qaFeeBdt?: string; localDeliveryBdt?: string; startsAt?: Date | null; note?: string };

const MONEY = /^\d+(\.\d{1,2})?$/;

/** Admin adds a new rate, live now or from a future date/time. */
export async function addShippingRate(actor: Actor, input: NewRateInput, now = new Date()) {
  assertCan(actor.role, "settings:manage");
  const vals = { airPerKgBdt: input.airPerKgBdt?.trim() || null, seaPerCbmBdt: input.seaPerCbmBdt?.trim() || null, qaFeeBdt: input.qaFeeBdt?.trim() || null, localDeliveryBdt: input.localDeliveryBdt?.trim() || null };
  for (const [k, v] of Object.entries(vals)) if (v !== null && !MONEY.test(v)) throw new UserError(`${{ airPerKgBdt: "Air per kg", seaPerCbmBdt: "Sea per CBM", qaFeeBdt: "QA fee", localDeliveryBdt: "Home delivery" }[k]}: enter an amount`);
  if (!vals.airPerKgBdt && !vals.seaPerCbmBdt) throw new UserError("Enter the air rate, the sea rate, or both");
  const effectiveFrom = input.startsAt ?? now;
  if (input.startsAt && input.startsAt.getTime() < now.getTime() - 60_000) throw new UserError("The start can't be in the past – use “Start now”");
  if (await prisma.shippingRate.findUnique({ where: { effectiveFrom } })) throw new UserError("Another rate starts at exactly that time");
  const r = await prisma.shippingRate.create({ data: { ...vals, effectiveFrom, note: input.note?.trim() || null, createdById: actor.id } });
  // CREATE row that also keeps the values, so the log shows what was set.
  await prisma.auditLog.create({ data: { entityType: "ShippingRate", entityId: r.id, userId: actor.id, action: "CREATE", newValue: { ...vals, effectiveFrom: effectiveFrom.toISOString() } } });
  return r;
}

/** Only rates that haven't started yet can be removed (history stays exact). */
export async function deleteUpcomingRate(actor: Actor, id: string, now = new Date()) {
  assertCan(actor.role, "settings:manage");
  const r = await prisma.shippingRate.findUnique({ where: { id } });
  if (!r) throw new UserError("Rate not found");
  if (r.effectiveFrom <= now) throw new UserError("This rate is already live or in the past – add a new rate instead");
  await prisma.shippingRate.delete({ where: { id } });
  await logChanges(prisma, { entityType: "ShippingRate", entityId: id, userId: actor.id, action: "DELETE" });
}
