import { describe, expect, it } from "vitest";
import { estimateShipping, hasRates } from "./shipping-estimate";

const rates = { airPerKgBdt: "750", seaPerCbmBdt: "28000", qaFeeBdt: "300", localDeliveryBdt: "120" };

describe("estimateShipping", () => {
  it("air bills weight, sea bills CBM, plus QA and delivery", () => {
    expect(estimateShipping({ method: "AIR", weightKg: "12.5", qa: true }, rates)).toEqual({ qty: 12.5, rate: 750, shipping: 9375, qa: 300, delivery: 120, total: 9795 });
    expect(estimateShipping({ method: "SEA", cbm: "0.084" }, rates)).toEqual({ qty: 0.084, rate: 28000, shipping: 2352, qa: 0, delivery: 120, total: 2472 });
  });
  it("returns null without a rate or a size", () => {
    expect(estimateShipping({ method: "AIR", weightKg: "" }, rates)).toBeNull();
    expect(estimateShipping({ method: "SEA", cbm: "1" }, { ...rates, seaPerCbmBdt: "" })).toBeNull();
    expect(hasRates({ ...rates, airPerKgBdt: "", seaPerCbmBdt: "0" })).toBe(false);
  });
});
