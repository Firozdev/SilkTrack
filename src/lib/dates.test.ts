import { describe, expect, it } from "vitest";
import { isoWeek, isoWeekStart, today, toYmd } from "./dates";

describe("dates", () => {
  it("gives today's date in a time zone", () => {
    const now = new Date("2026-10-01T19:00:00Z");
    expect(toYmd(today("Asia/Dhaka", now))).toBe("2026-10-02");
    expect(toYmd(today("UTC", now))).toBe("2026-10-01");
  });

  it("computes ISO weeks", () => {
    expect(isoWeek(new Date("2026-10-01T00:00:00Z"))).toEqual({ year: 2026, week: 40 });
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
    expect(toYmd(isoWeekStart(2026, 40))).toBe("2026-09-28");
  });
});
