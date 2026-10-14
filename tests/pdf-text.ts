import { inflateSync } from "node:zlib";

/**
 * Rough text of a PDF made with the standard fonts (enough for tests): inflate
 * every content stream and decode the hex strings drawn by Tj / TJ. Spaces are
 * dropped because kerning splits words, so search with spaces removed.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    let text: string;
    try {
      text = inflateSync(chunk).toString("latin1");
    } catch {
      continue;
    }
    for (const h of text.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], "hex").toString("latin1");
    out += "\n";
    re.lastIndex = end;
  }
  return out.replace(/\s+/g, "");
}

export const squash = (s: string) => s.replace(/\s+/g, "");
