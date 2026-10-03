import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes, escapes and guards formulas", () => {
    const csv = toCsv([{ a: 'He said "hi", ok', b: "=HYPERLINK(1)", c: -5 }]);
    expect(csv).toBe('﻿a,b,c\r\n"He said ""hi"", ok",\'=HYPERLINK(1),-5');
  });
});
