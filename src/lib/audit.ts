import type { AuditAction, Prisma } from "@/generated/prisma/client";

/** Fields whose changes must always be logged (CLAUDE.md / spec audit trail). */
export const AUDITED_FIELD_PATTERN =
  /(rmb|bdt|rate|rateused|weightkg|cbm|status|priceapproval|pct)$/i;

type Json = Prisma.InputJsonValue | null;

export type FieldChange = { field: string; oldValue: Json; newValue: Json };

function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal and other objects with a meaningful toString/toJSON
  if (typeof value === "object" && "toFixed" in value) return String(value);
  return value as Prisma.InputJsonValue;
}

/** List the fields that differ between `before` and `after` (only keys present in `after`). */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  onlyAudited = true,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of Object.keys(after)) {
    if (onlyAudited && !AUDITED_FIELD_PATTERN.test(field)) continue;
    const oldValue = toJson(before[field]);
    const newValue = toJson(after[field]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}

type AuditClient = { auditLog: { createMany: (args: { data: Prisma.AuditLogCreateManyInput[] }) => Promise<unknown> } };

/**
 * Write audit rows. Pass the transaction client so the log is saved
 * atomically with the change it describes.
 */
export async function logChanges(
  db: AuditClient,
  params: {
    entityType: string;
    entityId: string;
    userId: string | null;
    action: AuditAction;
    changes?: FieldChange[];
  },
): Promise<void> {
  const { entityType, entityId, userId, action, changes = [] } = params;
  const rows: Prisma.AuditLogCreateManyInput[] =
    action === "UPDATE"
      ? changes.map((c) => ({
          entityType,
          entityId,
          userId,
          action,
          field: c.field,
          oldValue: c.oldValue ?? undefined,
          newValue: c.newValue ?? undefined,
        }))
      : [{ entityType, entityId, userId, action }];
  if (rows.length) await db.auditLog.createMany({ data: rows });
}
