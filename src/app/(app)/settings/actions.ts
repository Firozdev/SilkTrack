"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { saveSettings } from "@/server/settings";

const opt = z.string().trim();

export const saveRatesAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const f = z
    .object({ shipping_service_air_per_kg_bdt: opt, shipping_service_sea_per_cbm_bdt: opt, shipping_service_qa_fee_bdt: opt, default_local_delivery_bdt: z.string().trim().min(1, "Home delivery charge is required") })
    .parse(fields(fd));
  await saveSettings(user, f);
  revalidatePath("/settings");
  return { ok: true, message: "Shipping rates saved. Customers see the new estimate right away." };
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
