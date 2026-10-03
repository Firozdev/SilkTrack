import { describe, expect, it } from "vitest";
import { allocate, cbmOf, D, money, pctChange, rmbToBdt, sum } from "./money";

describe("money helpers", () => {
  it("converts RMB to BDT with 2-dp half-up rounding", () => {
    expect(rmbToBdt("10.00", "17.2549").toString()).toBe("172.55");
    expect(rmbToBdt("0.1", "0.2").toString()).toBe("0.02");
  });

  it("avoids float errors", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(money("1.005").toString()).toBe("1.01");
  });

  it("computes CBM per carton", () => {
    expect(cbmOf(50, 40, 30).toString()).toBe("0.06");
    expect(cbmOf("33.3", "22.2", "11.1").toString()).toBe("0.0082");
  });

  it("allocates a total exactly by weight", () => {
    const parts = allocate("100.00", ["1", "1", "1"]);
    expect(parts.map(String)).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(parts).toString()).toBe("100");
    expect(allocate("10", ["0", "0"]).map(String)).toEqual(["5", "5"]);
    expect(allocate("7.5", ["2.5", "7.5"]).map(String)).toEqual(["1.87", "5.63"]);
  });

  it("computes percentage change", () => {
    expect(pctChange("10", "11")?.toString()).toBe("10");
    expect(pctChange("0", "11")).toBeNull();
    expect(D(null).toString()).toBe("0");
  });
});
