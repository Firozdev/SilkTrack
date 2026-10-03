import { describe, expect, it } from "vitest";
import { calcQuotation } from "./quotation";

describe("calcQuotation", () => {
  const lines = [
    { quantity: 10, unitPriceRmb: "12.50", unitWeightKg: "0.35", cartonCount: 1, lengthCm: "50", widthCm: "40", heightCm: "30" },
    { quantity: 4, unitPriceRmb: "30", unitWeightKg: "1.2", cartonCount: 2, lengthCm: "20", widthCm: "20", heightCm: "20" },
  ];

  it("computes air quotation by weight", () => {
    const r = calcQuotation({ shippingMethod: "AIR", shippingRatePerKgRmb: "40", domesticShippingRmb: "15", serviceFeeRmb: "10", lines }, "17.25");
    expect(r.lines.map((l) => [l.lineTotalRmb.toString(), l.weightKg.toString(), l.cbm.toString()])).toEqual([
      ["125", "3.5", "0.06"],
      ["120", "4.8", "0.016"],
    ]);
    expect(r.rmbSubtotal.toString()).toBe("245");
    expect(r.grossWeightKg.toString()).toBe("8.3");
    expect(r.cbm.toString()).toBe("0.076");
    expect(r.cartonCount).toBe(3);
    expect(r.shippingRmb.toString()).toBe("332"); // 8.3 × 40
    expect(r.totalRmb.toString()).toBe("602"); // 245 + 25 + 332
    expect(r.totalBdt.toString()).toBe("10384.5"); // 602 × 17.25
    expect(r.shippingBdt.toString()).toBe("5727");
    expect(r.productCostBdt.toString()).toBe("4657.5");
  });

  it("computes sea quotation by CBM and tolerates missing sizes", () => {
    const r = calcQuotation({ shippingMethod: "SEA", shippingRatePerCbmRmb: "1500", lines: [...lines, { quantity: 1, unitPriceRmb: "5" }] }, "17");
    expect(r.shippingRmb.toString()).toBe("114"); // 0.076 × 1500
    expect(r.totalRmb.toString()).toBe("364");
  });
});
