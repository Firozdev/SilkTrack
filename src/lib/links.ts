import type { Platform } from "@/generated/prisma/enums";

/** Query params that identify the product; everything else is tracking noise. */
const KEEP_PARAMS = ["id", "itemid", "item_id", "offerid", "productid"];

/** Canonical form of a product URL for the duplicate-link check. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|detail|item|h5)\./, "");
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => KEEP_PARAMS.includes(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort();
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return `${host}${path}${kept.length ? "?" + kept.join("&") : ""}`;
}

export function detectPlatform(raw: string): Platform {
  const s = raw.toLowerCase();
  if (s.includes("1688.com")) return "ALIBABA_1688";
  if (s.includes("tmall.com")) return "TMALL";
  if (s.includes("taobao.com") || s.includes("tb.cn")) return "TAOBAO";
  if (s.includes("alibaba.com")) return "ALIBABA";
  return "OTHER";
}

/** Split a textarea of links (one per line or space separated). */
export function splitLinks(text: string | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}
