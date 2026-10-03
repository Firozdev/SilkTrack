import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { getCurrentRate, rateForConversion, saveRate } from "@/server/rates";
import { makeUser, resetDb } from "../helpers";

describe("exchange rates", () => {
  beforeEach(resetDb);

  it("only Admin can save a rate", async () => {
    const cs = await makeUser("CS");
    const purchase = await makeUser("PURCHASE");
    await expect(saveRate(cs, { date: "2026-10-01", rate: "17.1" })).rejects.toThrow(ForbiddenError);
    await expect(saveRate(purchase, { date: "2026-10-01", rate: "17.1" })).rejects.toThrow(ForbiddenError);
  });

  it("logs every change to the audit log", async () => {
    const admin = await makeUser("ADMIN");
    const r = await saveRate(admin, { date: "2026-10-01", rate: "17.1000" });
    await saveRate(admin, { date: "2026-10-01", rate: "17.2500", sellingRate: "17.5" });
    const logs = await prisma.auditLog.findMany({ where: { entityId: r.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.field, l.oldValue, l.newValue])).toEqual([
      ["rate", null, "17.1"],
      ["rate", "17.1", "17.25"],
      ["sellingRate", null, "17.5"],
    ]);
  });

  it("falls back to the last rate when today has none", async () => {
    const admin = await makeUser("ADMIN");
    await saveRate(admin, { date: "2026-09-29", rate: "17.00" });
    await saveRate(admin, { date: "2026-09-30", rate: "17.20" });
    // 1 Oct 2026, 10:00 in Dhaka
    const now = new Date("2026-10-01T04:00:00Z");
    const { rate, isToday } = await getCurrentRate(now);
    expect(isToday).toBe(false);
    expect(rate?.rate.toString()).toBe("17.2");

    await saveRate(admin, { date: "2026-10-01", rate: "17.30" });
    const again = await getCurrentRate(now);
    expect(again.isToday).toBe(true);
    expect((await rateForConversion(now)).rateUsed.toString()).toBe("17.3");
  });

  it("uses the Bangladesh calendar day", async () => {
    const admin = await makeUser("ADMIN");
    await saveRate(admin, { date: "2026-10-02", rate: "18" });
    // 1 Oct 19:00 UTC is already 2 Oct 01:00 in Dhaka
    expect((await getCurrentRate(new Date("2026-10-01T19:00:00Z"))).isToday).toBe(true);
  });

  it("refuses conversion when no rate exists", async () => {
    await expect(rateForConversion()).rejects.toThrow(/No exchange rate/);
  });
});
