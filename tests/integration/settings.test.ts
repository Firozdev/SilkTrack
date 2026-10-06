import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { estimateShipping } from "@/lib/shipping-estimate";
import { allSettings, rateCard, saveSettings } from "@/server/settings";
import { defaultShippingRates } from "@/server/shipping-orders";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor;

describe("Settings – shipping rate card", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
  });

  it("only Admin can change settings; values are validated", async () => {
    await expect(saveSettings(cs, { shipping_service_air_per_kg_bdt: "750" })).rejects.toThrow(ForbiddenError);
    await expect(saveSettings(admin, { shipping_service_air_per_kg_bdt: "abc" })).rejects.toThrow(/Air rate per kg: enter a number/);
    await expect(saveSettings(admin, { bulk_threshold: { quantity: 0, valueBdt: "1" } })).rejects.toThrow(/Bulk threshold/);
  });

  it("saved rates feed the customer estimate and invoice defaults, and are audit logged", async () => {
    expect(await rateCard()).toEqual({ airPerKgBdt: "", seaPerCbmBdt: "", qaFeeBdt: "", localDeliveryBdt: "120.00" });
    await saveSettings(admin, { shipping_service_air_per_kg_bdt: "750", shipping_service_sea_per_cbm_bdt: "28000", shipping_service_qa_fee_bdt: "300", default_local_delivery_bdt: "150" });
    const rates = await rateCard();
    expect(rates).toEqual({ airPerKgBdt: "750", seaPerCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "150" });
    expect(estimateShipping({ method: "AIR", weightKg: "10", qa: true }, rates)?.total).toBe(7950); // 7500 + 300 + 150
    expect(await defaultShippingRates()).toEqual({ perKgBdt: "750", perCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "150" });

    const audit = await prisma.auditLog.findMany({ where: { entityType: "Setting" }, orderBy: { field: "asc" } });
    expect(audit.map((a) => [a.field, a.oldValue, a.newValue, a.userId])).toEqual([
      ["default_local_delivery_bdt", "120.00", "150", admin.id],
      ["shipping_service_air_per_kg_bdt", "", "750", admin.id],
      ["shipping_service_qa_fee_bdt", "", "300", admin.id],
      ["shipping_service_sea_per_cbm_bdt", "", "28000", admin.id],
    ]);
    // Saving the same values again logs nothing
    await saveSettings(admin, { shipping_service_air_per_kg_bdt: "750" });
    expect(await prisma.auditLog.count({ where: { entityType: "Setting" } })).toBe(4);
  });

  it("order rules are saved too", async () => {
    await saveSettings(admin, { bulk_threshold: { quantity: 100, valueBdt: "80000" }, price_change_alert_pct: "7.5", bd_weight_tolerance_pct: "3" });
    expect(await getSetting("bulk_threshold")).toEqual({ quantity: 100, valueBdt: "80000" });
    expect(await getSetting("price_change_alert_pct")).toBe("7.5");
    const { values, lastUpdated } = await allSettings();
    expect(values.bd_weight_tolerance_pct).toBe("3");
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(lastUpdated?.by).toBe(adminUser.name);
  });
});
