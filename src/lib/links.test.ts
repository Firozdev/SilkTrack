import { describe, expect, it } from "vitest";
import { detectPlatform, normalizeUrl, splitLinks } from "./links";

describe("normalizeUrl", () => {
  it("treats tracking variants of the same product as equal", () => {
    const a = normalizeUrl("https://item.taobao.com/item.htm?id=12345&spm=a1z10.1&ns=1");
    const b = normalizeUrl("http://m.taobao.com/item.htm?spm=xyz&id=12345");
    expect(a).toBe("taobao.com/item.htm?id=12345");
    expect(b).toBe(a);
  });

  it("keeps the path for 1688 offers and drops trailing slashes", () => {
    expect(normalizeUrl("https://detail.1688.com/offer/6543.html?spm=abc")).toBe("1688.com/offer/6543.html");
    expect(normalizeUrl("www.example.com/p/1/")).toBe("example.com/p/1");
  });

  it("detects the platform", () => {
    expect(detectPlatform("https://detail.1688.com/offer/1.html")).toBe("ALIBABA_1688");
    expect(detectPlatform("https://detail.tmall.com/item.htm?id=1")).toBe("TMALL");
    expect(detectPlatform("https://item.taobao.com/item.htm?id=1")).toBe("TAOBAO");
    expect(detectPlatform("https://www.alibaba.com/product/1")).toBe("ALIBABA");
    expect(detectPlatform("https://example.com")).toBe("OTHER");
  });

  it("splits a links textarea", () => {
    expect(splitLinks("a.com/1\n b.com/2 , a.com/1")).toEqual(["a.com/1", "b.com/2"]);
  });
});
