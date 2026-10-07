"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zStrOpt } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { saveSettings } from "@/server/settings";
import { addShippingRate, deleteUpcomingRate } from "@/server/shipping-rates";

export const addRateAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const f = z
    .object({
      airPerKgBdt: zStrOpt,
      seaPerCbmBdt: zStrOpt,
      qaFeeBdt: zStrOpt,
      localDeliveryBdt: zStrOpt,
      when: z.enum(["now", "later"]),
      // <input type="datetime-local"> in Bangladesh time (UTC+6)
      startsAt: zStrOpt,
      note: zStrOpt,
    })
    .parse(fields(fd));
  let startsAt: Date | null = null;
  if (f.when === "later") {
    if (!f.startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.startsAt)) return { error: "Choose the date and time the new rate starts" };
    startsAt = new Date(`${f.startsAt}:00+06:00`);
  }
  await addShippingRate(user, { ...f, startsAt });
  revalidatePath("/settings");
  return { ok: true, message: startsAt ? "Rate scheduled. It goes live automatically at the start time." : "New rate is live now. Earlier orders keep the rate they were placed with." };
});

export const deleteRateAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  await deleteUpcomingRate(user, id);
  revalidatePath("/settings");
  return { ok: true, message: "Upcoming rate deleted." };
});

export const saveOrderRulesAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const f = z
    .object({ bulkQuantity: z.coerce.number().int().min(1), bulkValueBdt: z.string().trim(), price_change_alert_pct: z.string().trim().min(1), bd_weight_tolerance_pct: z.string().trim().min(1) })
    .parse(fields(fd));
  await saveSettings(user, { bulk_threshold: { quantity: f.bulkQuantity, valueBdt: f.bulkValueBdt }, price_change_alert_pct: f.price_change_alert_pct, bd_weight_tolerance_pct: f.bd_weight_tolerance_pct });
  revalidatePath("/settings");
  return { ok: true, message: "Order rules saved." };
});
