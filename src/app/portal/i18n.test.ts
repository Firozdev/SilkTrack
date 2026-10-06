import { describe, expect, it } from "vitest";
import { DICTS, fill, translateError } from "./i18n";
import { portalLabel } from "./labels";

describe("portal i18n", () => {
  it("has a Bangla text for every English key, all non-empty", () => {
    const en = Object.keys(DICTS.en).sort();
    expect(Object.keys(DICTS.bn).sort()).toEqual(en);
    for (const k of en) expect(DICTS.bn[k as keyof typeof DICTS.bn].trim()).not.toBe("");
  });
  it("keeps the same {placeholders} in both languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(DICTS.en) as (keyof typeof DICTS.en)[]) expect(ph(DICTS.bn[k])).toBe(ph(DICTS.en[k]));
  });
  it("fills placeholders", () => {
    expect(fill(DICTS.bn.hello, { name: "করিম" })).toBe("স্বাগতম, করিম");
  });
  it("translates known server errors to Bangla and leaves English alone", () => {
    expect(translateError("bn", "Wrong phone number or password.")).toBe("মোবাইল নম্বর বা পাসওয়ার্ড ভুল।");
    expect(translateError("bn", "Password must be at least 8 characters")).toBe("পাসওয়ার্ড কমপক্ষে 8 অক্ষরের হতে হবে");
    expect(translateError("bn", "Your sign-up was not approved: Wrong address. Please contact us.")).toBe("আপনার সাইন আপ অনুমোদিত হয়নি (কারণ: Wrong address)। আমাদের সাথে যোগাযোগ করুন।");
    expect(translateError("bn", "Your sign-up was not approved. Please contact us.")).toBe("আপনার সাইন আপ অনুমোদিত হয়নি। আমাদের সাথে যোগাযোগ করুন।");
    expect(translateError("en", "Wrong phone number or password.")).toBe("Wrong phone number or password.");
    expect(translateError("bn", "Some new message")).toBe("Some new message");
  });
  it("labels statuses in Bangla", () => {
    expect(portalLabel("IN_TRANSIT", "bn")).toBe("বাংলাদেশের পথে");
    expect(portalLabel("IN_TRANSIT")).toBe("On the way to Bangladesh");
  });
});
