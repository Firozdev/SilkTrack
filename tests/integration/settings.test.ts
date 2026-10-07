import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { estimateShipping } from "@/lib/shipping-estimate";
import { allSettings, saveSettings } from "@/server/settings";
import { addShippingRate, deleteUpcomingRate, listShippingRates, liveRate, rateCard, rateCardFor } from "@/server/shipping-rates";
import { createShippingOrder, defaultShippingRates } from "@/server/shipping-orders";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor;
const H = 3_600_000;

describe("Shipping rate history", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
  });

  it("only Admin adds rates; values are validated", async () => {
    await expect(addShippingRate(cs, { airPerKgBdt: "750" })).rejects.toThrow(ForbiddenError);
    await expect(addShippingRate(admin, { airPerKgBdt: "7a" })).rejects.toThrow(/Air per kg: enter an amount/);
    await expect(addShippingRate(admin, { qaFeeBdt: "300" })).rejects.toThrow(/air rate, the sea rate, or both/);
    await expect(addShippingRate(admin, { airPerKgBdt: "750", startsAt: new Date(Date.now() - 2 * H) })).rejects.toThrow(/past/);
  });

  it("only one rate is live; scheduled rates go live on their own; history is kept", async () => {
    expect(await rateCard()).toEqual({ airPerKgBdt: "", seaPerCbmBdt: "", qaFeeBdt: "", localDeliveryBdt: "120.00" });
    const now = new Date();
    const a = await addShippingRate(admin, { airPerKgBdt: "750", seaPerCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "120", note: "Opening rate" }, now);
    const b = await addShippingRate(admin, { airPerKgBdt: "800", seaPerCbmBdt: "30000", qaFeeBdt: "300", localDeliveryBdt: "150", startsAt: new Date(now.getTime() + 48 * H) }, now);

    expect((await liveRate(now))?.id).toBe(a.id);
    let list = await listShippingRates(now);
    expect(list.map((r) => [r.id, r.status])).toEqual([
      [b.id, "UPCOMING"],
      [a.id, "LIVE"],
    ]);
    expect(list[1].endsAt?.getTime()).toBe(b.effectiveFrom.getTime());
    expect(estimateShipping({ method: "AIR", weightKg: 10, qa: true }, await rateCard(now))?.total).toBe(7920); // 7500 + 300 + 120

    // Two days later B is live and A is history
    const later = new Date(now.getTime() + 49 * H);
    expect((await liveRate(later))?.id).toBe(b.id);
    list = await listShippingRates(later);
    expect(list.map((r) => r.status)).toEqual(["LIVE", "PREVIOUS"]);
    expect(list.filter((r) => r.status === "LIVE")).toHaveLength(1);

    // Audit keeps what was set
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ShippingRate", entityId: a.id } });
    expect([audit.action, audit.userId, (audit.newValue as { airPerKgBdt: string }).airPerKgBdt]).toEqual(["CREATE", admin.id, "750"]);
  });

  it("only upcoming rates can be deleted", async () => {
    const now = new Date();
    const a = await addShippingRate(admin, { airPerKgBdt: "750" }, now);
    const b = await addShippingRate(admin, { airPerKgBdt: "800", startsAt: new Date(now.getTime() + H) }, now);
    await expect(deleteUpcomingRate(admin, a.id, now)).rejects.toThrow(/already live/);
    await expect(deleteUpcomingRate(cs, b.id, now)).rejects.toThrow(ForbiddenError);
    await deleteUpcomingRate(admin, b.id, now);
    expect(await prisma.shippingRate.count()).toBe(1);
  });

  it("an order keeps the rate it was placed with; new orders get the new rate", async () => {
    await addShippingRate(admin, { airPerKgBdt: "750", seaPerCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "120" }, new Date(Date.now() - 1000));
    const customer = { name: "R", phone: "01700000000", address: "x" };
    const first = await createShippingOrder(cs, { customer, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "a", quantity: 1 }] });
    await addShippingRate(admin, { airPerKgBdt: "900", seaPerCbmBdt: "32000", qaFeeBdt: "350", localDeliveryBdt: "150" });
    const second = await createShippingOrder(cs, { customer, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "b", quantity: 1 }] });

    expect((await rateCardFor(first.shippingRateId)).airPerKgBdt).toBe("750");
    expect((await rateCardFor(second.shippingRateId)).airPerKgBdt).toBe("900");
    expect(await defaultShippingRates(first.shippingRateId)).toEqual({ perKgBdt: "750", perCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "120" });
    expect((await defaultShippingRates(null)).perKgBdt).toBe("900"); // older orders without a locked rate use the live one
  });
});

describe("Settings – order rules", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
  });

  it("only Admin saves them; they are validated and audit logged", async () => {
    await expect(saveSettings(cs, { price_change_alert_pct: "7" })).rejects.toThrow(ForbiddenError);
    await expect(saveSettings(admin, { bulk_threshold: { quantity: 0, valueBdt: "1" } })).rejects.toThrow(/Bulk threshold/);
    await saveSettings(admin, { bulk_threshold: { quantity: 100, valueBdt: "80000" }, price_change_alert_pct: "7.5", bd_weight_tolerance_pct: "3" });
    expect(await getSetting("bulk_threshold")).toEqual({ quantity: 100, valueBdt: "80000" });
    expect(await getSetting("price_change_alert_pct")).toBe("7.5");
    const { values, lastUpdated } = await allSettings();
    expect(values.bd_weight_tolerance_pct).toBe("3");
    expect(lastUpdated?.by).toBe((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).name);
    expect(await prisma.auditLog.count({ where: { entityType: "Setting" } })).toBe(3);
    await saveSettings(admin, { price_change_alert_pct: "7.5" });
    expect(await prisma.auditLog.count({ where: { entityType: "Setting" } })).toBe(3);
  });
});
