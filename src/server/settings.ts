import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { SETTING_DEFAULTS, getSetting, type SettingKey } from "@/lib/settings";
import type { RateCard } from "@/lib/shipping-estimate";
import type { Actor } from "./actor";

/** The shipping rate card customers see as an estimate. */
export async function rateCard(): Promise<RateCard> {
  const [airPerKgBdt, seaPerCbmBdt, qaFeeBdt, localDeliveryBdt] = await Promise.all([
    getSetting("shipping_service_air_per_kg_bdt"),
    getSetting("shipping_service_sea_per_cbm_bdt"),
    getSetting("shipping_service_qa_fee_bdt"),
    getSetting("default_local_delivery_bdt"),
  ]);
  return { airPerKgBdt, seaPerCbmBdt, qaFeeBdt, localDeliveryBdt };
}

export async function allSettings() {
  const rows = await prisma.setting.findMany({ include: { updatedBy: { select: { name: true } } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const values = Object.fromEntries((Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((k) => [k, byKey.get(k)?.value ?? SETTING_DEFAULTS[k]])) as { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] extends string ? string : { quantity: number; valueBdt: string } };
  const last = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return { values, lastUpdated: last ? { at: last.updatedAt, by: last.updatedBy?.name ?? null } : null };
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const PCT = /^\d+(\.\d+)?$/;

export type SettingsInput = Partial<{
  shipping_service_air_per_kg_bdt: string;
  shipping_service_sea_per_cbm_bdt: string;
  shipping_service_qa_fee_bdt: string;
  default_local_delivery_bdt: string;
  price_change_alert_pct: string;
  bd_weight_tolerance_pct: string;
  bulk_threshold: { quantity: number; valueBdt: string };
}>;

const LABEL: Record<string, string> = {
  shipping_service_air_per_kg_bdt: "Air rate per kg",
  shipping_service_sea_per_cbm_bdt: "Sea rate per CBM",
  shipping_service_qa_fee_bdt: "QA fee",
  default_local_delivery_bdt: "Home delivery charge",
  price_change_alert_pct: "Price-change alert %",
  bd_weight_tolerance_pct: "BD weight tolerance %",
};

/** Admin saves settings. Every changed value goes to the audit log. */
export async function saveSettings(actor: Actor, input: SettingsInput) {
  assertCan(actor.role, "settings:manage");
  for (const [k, v] of Object.entries(input)) {
    if (k === "bulk_threshold") {
      const b = v as { quantity: number; valueBdt: string };
      if (!Number.isInteger(b.quantity) || b.quantity < 1 || !MONEY.test(b.valueBdt)) throw new UserError("Bulk threshold: enter a quantity and a BDT value");
    } else if (typeof v === "string" && v !== "" && !(k.endsWith("_pct") ? PCT : MONEY).test(v)) {
      throw new UserError(`${LABEL[k] ?? k}: enter a number`);
    }
  }
  const before = await allSettings();
  await prisma.$transaction(async (tx) => {
    for (const [k, v] of Object.entries(input) as [SettingKey, string | { quantity: number; valueBdt: string }][]) {
      const old = before.values[k];
      if (JSON.stringify(old) === JSON.stringify(v)) continue;
      await tx.setting.upsert({ where: { key: k }, update: { value: v, updatedById: actor.id }, create: { key: k, value: v, updatedById: actor.id, description: LABEL[k] } });
      await logChanges(tx, { entityType: "Setting", entityId: k, userId: actor.id, action: "UPDATE", changes: [{ field: k, oldValue: old, newValue: v }] });
    }
  });
}
