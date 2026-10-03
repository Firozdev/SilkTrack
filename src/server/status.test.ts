import { describe, expect, it } from "vitest";
import { deriveOrderStatus, legFor } from "./status";

describe("deriveOrderStatus", () => {
  it("follows the least advanced active line", () => {
    expect(deriveOrderStatus(["PURCHASED", "AT_CHINA_WAREHOUSE"])).toBe("PURCHASED");
    expect(deriveOrderStatus(["DELIVERED", "CANCELLED"])).toBe("DELIVERED");
    expect(deriveOrderStatus(["CANCELLED", "CANCELLED"])).toBe("CANCELLED");
    expect(deriveOrderStatus([])).toBe("REQUESTED");
  });

  it("maps statuses to tracking legs", () => {
    expect(legFor("PURCHASED")).toBe("SUPPLIER_TO_CHINA");
    expect(legFor("IN_TRANSIT")).toBe("CHINA_TO_BD");
    expect(legFor("DELIVERED")).toBe("BD_TO_CUSTOMER");
  });
});
