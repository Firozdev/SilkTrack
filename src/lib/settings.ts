import "server-only";
import { prisma } from "./prisma";

/** Defaults used when a setting row is missing. Admin edits them in Settings. */
export const SETTING_DEFAULTS = {
  bulk_threshold: { quantity: 50, valueBdt: "50000.00" },
  price_change_alert_pct: "5",
  bd_weight_tolerance_pct: "5",
  default_local_delivery_bdt: "120.00",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K] extends string ? string : { quantity: number; valueBdt: string };

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value ?? SETTING_DEFAULTS[key]) as SettingValue<K>;
}
