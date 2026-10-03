import { describe, expect, it } from "vitest";
import { docNo, fmtBdt, fmtRmb, humanize, parseDocNo } from "./format";

describe("format", () => {
  it("humanizes enum values", () => {
    expect(humanize("ARRIVED_BD")).toBe("Arrived BD");
    expect(humanize("AT_CHINA_WAREHOUSE")).toBe("At China warehouse");
    expect(humanize("OUT_FOR_DELIVERY")).toBe("Out for delivery");
  });
  it("formats money and document numbers", () => {
    expect(fmtBdt("1234567.5")).toBe("৳1,234,567.50");
    expect(fmtRmb("-12")).toBe("-¥12.00");
    expect(docNo("order", 42)).toBe("REQ-000042");
    expect(parseDocNo("req-000042")).toBe(42);
  });
});
