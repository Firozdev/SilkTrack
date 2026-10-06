import "server-only";
import { files } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { saveLineFiles } from "@/lib/uploads";

/**
 * Files posted per product row as `p.<row>.files`, saved on the matching
 * created line. Rows are matched the same way the create functions keep them
 * (non-blank name, quantity > 0), in order, so row n → lineNo n.
 */
type Row = { _i: string; productName: string; quantity: number };
const kept = (rows: Row[]) => rows.filter((r) => r.productName.trim() && r.quantity > 0);

export async function saveItemFiles(fd: FormData, rows: Row[], shippingOrderId: string, uploader: string | { accountId: string }) {
  const items = await prisma.shippingOrderItem.findMany({ where: { shippingOrderId }, orderBy: { lineNo: "asc" }, select: { id: true } });
  for (const [n, r] of kept(rows).entries()) {
    const list = files(fd, `p.${r._i}.files`);
    if (list.length && items[n]) await saveLineFiles(list, uploader, { shippingOrderItemId: items[n].id });
  }
}

/** Sample lines have no line number: match each row to an unused line with the same product name. */
export async function saveSampleLineFiles(fd: FormData, rows: Row[], sampleId: string, uploader: string) {
  const lines = await prisma.sampleLine.findMany({ where: { sampleId }, select: { id: true, productName: true } });
  const used = new Set<string>();
  for (const r of kept(rows)) {
    const list = files(fd, `p.${r._i}.files`);
    const line = lines.find((l) => !used.has(l.id) && l.productName === r.productName.trim());
    if (!line) continue;
    used.add(line.id);
    if (list.length) await saveLineFiles(list, uploader, { sampleLineId: line.id });
  }
}
