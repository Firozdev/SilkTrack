import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { saveAttachments, MAX_FILES_PER_UPLOAD } from "@/lib/uploads";
import type { Actor } from "./actor";

/**
 * Product images China attaches to each line of its quotation. They belong to
 * one quotation version and one product (order line); a revision copies them.
 * China (or Admin) changes them while the quotation is a draft. Customers see
 * them once the quotation is sent to them.
 */

const TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

async function draftFor(actor: Actor, estimateId: string) {
  assertCan(actor.role, "estimate:edit");
  const e = await prisma.estimate.findUnique({ where: { id: estimateId }, select: { id: true, status: true, version: true, order: { select: { lines: { select: { id: true } } } } } });
  if (!e) throw new UserError("Quotation not found");
  if (e.status !== "DRAFT") throw new UserError(`Quotation v${e.version} is ${e.status.toLowerCase().replace(/_/g, " ")} – revise it to change images`);
  return e;
}

/** Images only (JPG, PNG or WebP – checked by content, not just the name), at most 10 per product. */
export async function checkQuoteImages(perLine: Record<string, File[]>) {
  for (const files of Object.values(perLine)) {
    if (files.length > MAX_FILES_PER_UPLOAD) throw new UserError(`Upload at most ${MAX_FILES_PER_UPLOAD} images per product at a time`);
    for (const f of files) {
      const check = TYPES[f.type];
      if (!check || !check(Buffer.from(await f.slice(0, 16).arrayBuffer()))) throw new UserError(`${f.name}: only JPG, PNG or WebP images can be attached to a quotation`);
    }
  }
}

/** Save images per product line ({ orderLineId: files }). */
export async function addQuoteImages(actor: Actor, estimateId: string, perLine: Record<string, File[]>) {
  const e = await draftFor(actor, estimateId);
  const lineIds = new Set(e.order.lines.map((l) => l.id));
  const entries = Object.entries(perLine).filter(([, f]) => f.length);
  for (const [orderLineId] of entries) if (!lineIds.has(orderLineId)) throw new UserError("That product is not on this quotation");
  await checkQuoteImages(perLine);
  for (const [orderLineId, files] of entries) await saveAttachments(files, "QUOTE_IMAGE", actor.id, { estimateId, estimateOrderLineId: orderLineId });
  const count = entries.reduce((a, [, f]) => a + f.length, 0);
  if (count) await logChanges(prisma, { entityType: "Estimate", entityId: estimateId, userId: actor.id, action: "UPDATE", changes: [{ field: "quoteImagesAdded", oldValue: null, newValue: String(count) }] });
}

export async function removeQuoteImages(actor: Actor, estimateId: string, attachmentIds: string[]) {
  if (!attachmentIds.length) return;
  await draftFor(actor, estimateId);
  const gone = await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds }, estimateId, kind: "QUOTE_IMAGE" } });
  if (gone.count) await logChanges(prisma, { entityType: "Estimate", entityId: estimateId, userId: actor.id, action: "UPDATE", changes: [{ field: "quoteImagesRemoved", oldValue: null, newValue: String(gone.count) }] });
}

/** A revision starts with the previous version's images (same stored files). */
export async function copyQuoteImages(tx: Prisma.TransactionClient, fromEstimateId: string, toEstimateId: string) {
  const rows = await tx.attachment.findMany({ where: { estimateId: fromEstimateId, kind: "QUOTE_IMAGE" } });
  if (!rows.length) return;
  await tx.attachment.createMany({
    data: rows.map(({ storageKey, fileName, mimeType, sizeBytes, uploadedById, estimateOrderLineId }) => ({ kind: "QUOTE_IMAGE" as const, storageKey, fileName, mimeType, sizeBytes, uploadedById, estimateId: toEstimateId, estimateOrderLineId })),
  });
}

export const quoteImageSelect = { where: { kind: "QUOTE_IMAGE" }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, mimeType: true, estimateOrderLineId: true } } as const;

/** Group a quotation's images by product line. */
export function imagesByLine<T extends { estimateOrderLineId: string | null }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) if (r.estimateOrderLineId) m.set(r.estimateOrderLineId, [...(m.get(r.estimateOrderLineId) ?? []), r]);
  return m;
}
