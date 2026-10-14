"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zBool, zStrOpt } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { saveSettings } from "@/server/settings";
import { createPaymentAccount, deletePaymentAccount, movePaymentAccount, saveOrganization, setShowOnPdf, updatePaymentAccount } from "@/server/organization";
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
  revalidatePath("/settings/shipping-charges");
  return { ok: true, message: startsAt ? "Rate scheduled. It goes live automatically at the start time." : "New rate is live now. Earlier orders keep the rate they were placed with." };
});

export const deleteRateAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  await deleteUpcomingRate(user, id);
  revalidatePath("/settings/shipping-charges");
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

// ───────── Organization and payment information (Admin only) ─────────

export const saveOrganizationAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const f = z.object({ name: z.string(), tagline: zStrOpt, phone: zStrOpt, email: zStrOpt, website: zStrOpt, address: zStrOpt, removeLogo: zStrOpt }).parse(fields(fd));
  const logo = fd.get("logo");
  await saveOrganization(user, { name: f.name, tagline: f.tagline ?? "", phone: f.phone ?? "", email: f.email ?? "", website: f.website ?? "", address: f.address ?? "" }, { logo: logo instanceof File ? logo : null, removeLogo: f.removeLogo === "yes" });
  revalidatePath("/settings", "layout");
  return { ok: true, message: "Organization details saved." };
});

const ACCOUNT = z.object({
  type: z.enum(["BANK", "MOBILE_BANKING", "OTHER"]),
  providerName: z.string(),
  accountName: z.string(),
  accountNumber: z.string(),
  branch: zStrOpt,
  routingNumber: zStrOpt,
  notes: zStrOpt,
  showOnPdf: zBool,
});

export const addPaymentAccountAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  await createPaymentAccount(user, ACCOUNT.parse(fields(fd)));
  revalidatePath("/settings/payment-accounts");
  return { ok: true, message: "Account added." };
});

export const updatePaymentAccountAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  await updatePaymentAccount(user, id, ACCOUNT.parse(fields(fd)));
  revalidatePath("/settings/payment-accounts");
  return { ok: true, message: "Account saved." };
});

export const togglePaymentAccountAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id, show } = z.object({ id: z.string().min(1), show: z.enum(["yes", "no"]) }).parse(fields(fd));
  await setShowOnPdf(user, id, show === "yes");
  revalidatePath("/settings/payment-accounts");
  return { ok: true };
});

export const movePaymentAccountAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id, direction } = z.object({ id: z.string().min(1), direction: z.enum(["up", "down"]) }).parse(fields(fd));
  await movePaymentAccount(user, id, direction);
  revalidatePath("/settings/payment-accounts");
  return { ok: true };
});

export const deletePaymentAccountAction = formAction(async (fd) => {
  const user = await requirePermission("settings:manage");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  await deletePaymentAccount(user, id);
  revalidatePath("/settings/payment-accounts");
  return { ok: true, message: "Account deleted." };
});
