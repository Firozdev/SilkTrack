import { describe, expect, it } from "vitest";
import { normalizeBdPhone, phoneVariants } from "./phone";

describe("normalizeBdPhone", () => {
  it("accepts local and international forms", () => {
    for (const p of ["01711000000", "+880 1711-000000", "8801711000000", "1711000000"]) expect(normalizeBdPhone(p)).toBe("01711000000");
  });
  it("rejects non-mobile numbers", () => {
    for (const p of ["0171100000", "02123456789", "01211000000", "abc"]) expect(normalizeBdPhone(p)).toBeNull();
  });
  it("lists stored variants", () => {
    expect(phoneVariants("01711000000")).toEqual(["01711000000", "8801711000000", "+8801711000000"]);
  });
});
