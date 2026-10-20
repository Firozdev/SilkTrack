import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deleteStoredFile } from "@/lib/uploads";
import type { Actor } from "./actor";

/**
 * Trash: Admin deletes any record together with everything that belongs to it.
 * The rows are copied into a TrashItem (as JSON, in the database – no rounding
 * of money) and then removed, so every list, report and portal page simply no
 * longer sees them. Restore puts the same rows back; "delete forever" drops
 * the copy and the uploaded files.
 *
 * What goes with what is decided per foreign key (FK_RULES):
 *  - own:    the referencing row belongs to the deleted one and goes with it
 *  - unlink: the referencing row stays; its link is cleared (and put back on restore)
 *  - block:  the record can't be deleted while such rows exist (staff users with
 *            history, exchange rates prices were saved with)
 * A test checks that every foreign key in the database has a rule.
 */

type Rule = "own" | "unlink" | "block";
type Db = Prisma.TransactionClient | typeof prisma;

const OWN = [
  // files and generated PDFs go with what they belong to
  "Attachment.claimId", "Attachment.commentId", "Attachment.deliveryId", "Attachment.estimateId", "Attachment.issueId",
  "Attachment.orderId", "Attachment.orderLineId", "Attachment.paymentSubmissionId", "Attachment.receivingId",
  "Attachment.sampleId", "Attachment.sampleLineId", "Attachment.shippingOrderId", "Attachment.shippingOrderItemId",
  "Attachment.supplierOrderId",
  "GeneratedDocument.estimateId", "GeneratedDocument.invoiceId", "GeneratedDocument.paymentId", "GeneratedDocument.shippingOrderId",
  // notifications about the record
  "Notification.customerId", "Notification.eventId", "Notification.orderId", "Notification.portalAccountId", "Notification.userId",
  "NotificationEvent.customerId", "NotificationEvent.issueId", "NotificationEvent.orderId", "NotificationEvent.sampleId",
  "NotificationEvent.shipmentId", "NotificationEvent.shippingOrderId",
  // customer → everything recorded for them
  "Order.customerId", "Sample.customerId", "ShippingOrder.customerId", "PaymentSubmission.customerId", "PortalAccount.customerId",
  // order → its lines, quotes, samples, money, delivery and claims
  "OrderLine.orderId", "Comment.orderId", "Estimate.orderId", "Invoice.orderId", "Delivery.orderId", "Claim.orderId",
  "Issue.orderId", "Payment.orderId", "Sample.orderId", "PaymentSubmission.orderId",
  "ProductLink.orderLineId", "PurchaseLine.orderLineId", "ReceivingLine.orderLineId", "TrackingEvent.orderLineId", "Issue.orderLineId",
  "EstimateLine.estimateId",
  // sample / shipping order
  "SampleEvent.sampleId", "SampleLine.sampleId", "Payment.sampleId", "PaymentSubmission.sampleId",
  "ShippingOrderCarton.shippingOrderId", "ShippingOrderEvent.shippingOrderId", "ShippingOrderItem.shippingOrderId",
  "Payment.shippingOrderId", "PaymentSubmission.shippingOrderId", "CustomInvoice.shippingOrderId",
  // purchasing, receiving, shipments
  "SupplierOrder.supplierId", "PurchaseLine.supplierOrderId", "Carton.receivingId", "ReceivingLine.receivingId",
  "BdReceivingItem.receivingId", "BdReceivingItem.shipmentId",
  // portal login → its sessions, links, payment proofs and custom invoices
  "PortalSession.accountId", "PortalToken.accountId", "PaymentSubmission.accountId", "CustomInvoice.accountId",
];

const BLOCK = [
  // staff users who did work: deleting them would delete that work – disable instead
  "AuditLog.userId", "Attachment.uploadedById", "BdReceivingItem.checkedById", "Claim.createdById", "Claim.decidedById",
  "Comment.authorId", "Delivery.assignedById", "Estimate.createdById", "Estimate.reviewedById", "ExchangeRate.updatedById",
  "GeneratedDocument.createdById", "Invoice.issuedById", "Issue.assignedToId", "Issue.reportedById",
  "Order.advanceRequestedById", "Order.createdById", "Order.qaById", "Payment.receivedById", "PaymentSubmission.reviewedById",
  "PortalAccount.invitedById", "PortalAccount.reviewedById", "PortalToken.createdById", "PurchaseLine.priceApprovedById",
  "Receiving.receivedById", "Sample.invoicedById", "Sample.purchasedById", "Sample.requestedById", "SampleEvent.createdById",
  "Setting.updatedById", "ShippingOrder.createdById", "ShippingOrder.invoicedById", "ShippingOrder.qaById",
  "ShippingOrder.receivedChinaById", "ShippingOrderEvent.createdById", "ShippingRate.createdById", "SupplierOrder.purchasedById",
  "TrackingEvent.createdById",
  // exchange rates that prices were saved with
  "Estimate.exchangeRateId", "Invoice.exchangeRateId", "SupplierOrder.exchangeRateId", "Sample.exchangeRateId",
  "ShippingOrder.exchangeRateId",
];

const UNLINK = [
  "Attachment.uploadedByAccountId", "Claim.issueId", "Claim.orderLineId", "Customer.agentAccountId", "Estimate.previousVersionId",
  "EstimateLine.orderLineId", "Issue.receivingId", "Order.placedByAccountId", "Payment.invoiceId", "PaymentSubmission.paymentId",
  "Receiving.repackedIntoId", "Receiving.shipmentId", "Receiving.supplierOrderId", "ReceivingLine.purchaseLineId",
  "Sample.requestedByAccountId", "Sample.shipmentId", "SampleLine.orderLineId", "ShippingOrder.placedByAccountId",
  "ShippingOrder.shipmentId", "ShippingOrder.shippingRateId", "TrackingEvent.shipmentId", "TrashItem.deletedById",
];

export const FK_RULES: Record<string, Rule> = Object.fromEntries([
  ...OWN.map((k) => [k, "own"]),
  ...BLOCK.map((k) => [k, "block"]),
  ...UNLINK.map((k) => [k, "unlink"]),
]);

/** Records that have a Delete button. `href` opens the record; `back` is where to go after deleting it. */
export const TRASHABLE = {
  Customer: { noun: "customer", back: "/customers", href: (id: string) => `/customers/${id}` },
  Order: { noun: "request / order", back: "/requests", href: (id: string) => `/requests/${id}` },
  Estimate: { noun: "quotation", back: "/estimates", href: (id: string) => `/estimates/${id}` },
  Sample: { noun: "sample", back: "/samples", href: (id: string) => `/samples/${id}` },
  ShippingOrder: { noun: "shipping order", back: "/shipping-orders", href: (id: string) => `/shipping-orders/${id}` },
  Shipment: { noun: "weekly shipment", back: "/shipments", href: (id: string) => `/shipments/${id}` },
  SupplierOrder: { noun: "purchase", back: "/purchasing", href: (id: string) => `/purchasing/${id}` },
  Receiving: { noun: "receiving", back: "/receiving", href: (id: string) => `/receiving/${id}` },
  Payment: { noun: "payment", back: "/customers", href: null },
  Invoice: { noun: "invoice", back: "/customers", href: null },
  PaymentSubmission: { noun: "payment proof", back: "/payments-to-verify", href: null },
  Issue: { noun: "issue", back: "/issues", href: null },
  Claim: { noun: "claim", back: "/requests", href: null },
  Delivery: { noun: "delivery", back: "/requests", href: null },
  Comment: { noun: "comment", back: "/requests", href: null },
  Attachment: { noun: "file", back: "/requests", href: null },
  Supplier: { noun: "supplier", back: "/purchasing", href: null },
  PortalAccount: { noun: "portal login", back: "/settings/users?tab=portal", href: null },
  User: { noun: "staff user", back: "/settings/users", href: null },
  ExchangeRate: { noun: "exchange rate", back: "/settings/exchange-rates", href: null },
  ShippingRate: { noun: "shipping charges", back: "/settings/shipping-charges", href: null },
} as const satisfies Record<string, { noun: string; back: string; href: ((id: string) => string) | null }>;

export type Trashable = keyof typeof TRASHABLE;

export function isTrashable(t: string): t is Trashable {
  return Object.hasOwn(TRASHABLE, t);
}

const no = (prefix: string) => `'${prefix}-' || lpad(x.number::text, 6, '0')`;
const LABEL_SQL: Record<Trashable, string> = {
  Customer: `select 'Customer ' || x.code || ' – ' || x.name from "Customer" x where x.id = $1`,
  Order: `select 'Request ' || ${no("REQ")} || ' – ' || c.name from "Order" x join "Customer" c on c.id = x."customerId" where x.id = $1`,
  Estimate: `select 'Quotation ' || ${no("EST")} || ' v' || x.version from "Estimate" x where x.id = $1`,
  Sample: `select 'Sample ' || ${no("SMP")} || ' – ' || c.name from "Sample" x join "Customer" c on c.id = x."customerId" where x.id = $1`,
  ShippingOrder: `select 'Shipping order ' || ${no("SHO")} || ' – ' || c.name from "ShippingOrder" x join "Customer" c on c.id = x."customerId" where x.id = $1`,
  Shipment: `select 'Weekly shipment ' || x.code from "Shipment" x where x.id = $1`,
  SupplierOrder: `select 'Purchase ' || ${no("PUR")} || ' – ' || s.name from "SupplierOrder" x join "Supplier" s on s.id = x."supplierId" where x.id = $1`,
  Receiving: `select 'Receiving ' || ${no("RCV")} from "Receiving" x where x.id = $1`,
  Payment: `select 'Payment ' || ${no("PAY")} || ' – ৳' || x."amountBdt" from "Payment" x where x.id = $1`,
  Invoice: `select 'Invoice ' || ${no("INV")} || ' – ৳' || x."totalBdt" from "Invoice" x where x.id = $1`,
  PaymentSubmission: `select 'Payment proof #' || x.number || ' – ৳' || x."amountBdt" from "PaymentSubmission" x where x.id = $1`,
  Issue: `select 'Issue ' || ${no("ISS")} from "Issue" x where x.id = $1`,
  Claim: `select 'Claim ' || ${no("CLM")} from "Claim" x where x.id = $1`,
  Delivery: `select 'Delivery ' || ${no("DLV")} from "Delivery" x where x.id = $1`,
  Comment: `select 'Comment: ' || left(x.body, 60) from "Comment" x where x.id = $1`,
  Attachment: `select 'File ' || x."fileName" from "Attachment" x where x.id = $1`,
  Supplier: `select 'Supplier ' || x.name from "Supplier" x where x.id = $1`,
  PortalAccount: `select case x.kind when 'AGENT' then 'Agent ' else 'Portal login ' end || x.name || ' (' || x.phone || ')' from "PortalAccount" x where x.id = $1`,
  User: `select 'Staff user ' || x.name || ' (' || x.email || ')' from "User" x where x.id = $1`,
  ExchangeRate: `select 'Exchange rate ' || to_char(x."effectiveDate", 'YYYY-MM-DD') || ' (1 ¥ = ৳' || x.rate || ')' from "ExchangeRate" x where x.id = $1`,
  ShippingRate: `select 'Shipping charges from ' || to_char(x."effectiveFrom", 'YYYY-MM-DD') from "ShippingRate" x where x.id = $1`,
};

// ---------------------------------------------------------------------------
// Foreign keys, read from the database

type Fk = { child: string; column: string; parent: string; required: boolean; rule: Rule };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unexpected identifier: ${name}`);
  return `"${name}"`;
}

/** Every single-column foreign key in the app's schema. */
export async function listForeignKeys(db: Db = prisma) {
  return db.$queryRawUnsafe<{ child: string; column: string; parent: string; required: boolean }[]>(`
    select cl.relname as child, a.attname as "column", pl.relname as parent, a.attnotnull as required
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class pl on pl.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = to_regnamespace(current_schema())
    order by 1, 2`);
}

let fkCache: Fk[] | null = null;
async function foreignKeys(db: Db): Promise<Fk[]> {
  if (fkCache) return fkCache;
  const rows = await listForeignKeys(db);
  const missing = rows.filter((r) => !FK_RULES[`${r.child}.${r.column}`]).map((r) => `${r.child}.${r.column}`);
  if (missing.length) throw new Error(`Trash: no delete rule for ${missing.join(", ")}`);
  const bad = rows.filter((r) => r.required && FK_RULES[`${r.child}.${r.column}`] === "unlink").map((r) => `${r.child}.${r.column}`);
  if (bad.length) throw new Error(`Trash: required links can't be cleared: ${bad.join(", ")}`);
  fkCache = rows.map((r) => ({ ...r, rule: FK_RULES[`${r.child}.${r.column}`] }));
  return fkCache;
}

/** Tables in the order to insert them (a row's required parents first). */
function insertOrder(fks: Fk[], tables: Iterable<string>): string[] {
  const todo = new Set(tables);
  const out: string[] = [];
  while (todo.size) {
    const ready = [...todo].filter((t) => !fks.some((f) => f.child === t && f.required && f.parent !== t && todo.has(f.parent)));
    if (!ready.length) throw new Error(`Trash: circular required links between ${[...todo].join(", ")}`);
    ready.sort();
    for (const t of ready) {
      todo.delete(t);
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Working out what a delete touches

type Plan = {
  label: string;
  rows: Map<string, Set<string>>; // table → ids to delete
  unlinks: { table: string; column: string; id: string; value: string }[];
  blockers: { table: string; column: string; count: number }[];
};

const GONE = "This record no longer exists.";

async function label(db: Db, type: Trashable, id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ label: string | null }[]>(`select label from (${LABEL_SQL[type]}) as s(label)`, id);
  if (!rows.length) throw new UserError(GONE);
  return rows[0].label ?? TRASHABLE[type].noun;
}

async function plan(db: Db, type: Trashable, id: string): Promise<Plan> {
  const fks = await foreignKeys(db);
  const lbl = await label(db, type, id);
  const rows = new Map<string, Set<string>>([[type, new Set([id])]]);
  let frontier = new Map<string, string[]>([[type, [id]]]);
  while (frontier.size) {
    const next = new Map<string, string[]>();
    for (const [table, ids] of frontier) {
      for (const fk of fks) {
        if (fk.parent !== table || fk.rule !== "own") continue;
        const found = await db.$queryRawUnsafe<{ id: string }[]>(`select id from ${q(fk.child)} where ${q(fk.column)} = any($1::text[])`, ids);
        for (const { id: cid } of found) {
          const set = rows.get(fk.child) ?? new Set<string>();
          if (set.has(cid)) continue;
          set.add(cid);
          rows.set(fk.child, set);
          next.set(fk.child, [...(next.get(fk.child) ?? []), cid]);
        }
      }
    }
    frontier = next;
  }

  const unlinks: Plan["unlinks"] = [];
  const blockers: Plan["blockers"] = [];
  for (const [table, ids] of rows) {
    for (const fk of fks) {
      if (fk.parent !== table || fk.rule === "own") continue;
      if (fk.rule === "block" && !rows.has(fk.child)) {
        // (some tables, e.g. Setting, have no id column – only count them)
        const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from ${q(fk.child)} where ${q(fk.column)} = any($1::text[])`, [...ids]);
        if (n) blockers.push({ table: fk.child, column: fk.column, count: n });
        continue;
      }
      const refs = await db.$queryRawUnsafe<{ id: string; value: string }[]>(
        `select id, ${q(fk.column)} as value from ${q(fk.child)} where ${q(fk.column)} = any($1::text[])`,
        [...ids],
      );
      const outside = refs.filter((r) => !rows.get(fk.child)?.has(r.id));
      if (!outside.length) continue;
      if (fk.rule === "block") blockers.push({ table: fk.child, column: fk.column, count: outside.length });
      else unlinks.push(...outside.map((r) => ({ table: fk.child, column: fk.column, id: r.id, value: r.value })));
    }
  }
  return { label: lbl, rows, unlinks, blockers };
}

/** Names the app uses, where they differ from the table name. */
const NOUNS: Record<string, string> = {
  Order: "request",
  OrderLine: "product line",
  Estimate: "quotation",
  EstimateLine: "quotation line",
  SupplierOrder: "purchase",
  PaymentSubmission: "payment proof",
  Attachment: "file",
  GeneratedDocument: "PDF",
  PortalAccount: "portal login",
  PortalSession: "login session",
  PortalToken: "portal link",
  AuditLog: "audit log entry",
  BdReceivingItem: "BD receiving check",
  CustomInvoice: "custom invoice",
  Shipment: "weekly shipment",
};

/** "OrderLine" → "product line(s)". */
export function tableNoun(table: string, n: number): string {
  const words = NOUNS[table] ?? table.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (n === 1) return words;
  return words.endsWith("y") && !words.endsWith("ey") ? `${words.slice(0, -1)}ies` : words.endsWith("ch") ? `${words}es` : `${words}s`;
}

function blockMessage(type: Trashable, blockers: Plan["blockers"]): string {
  const total = new Map<string, number>();
  for (const b of blockers) total.set(b.table, (total.get(b.table) ?? 0) + b.count);
  const list = [...total].map(([t, n]) => `${n} ${tableNoun(t, n)}`).join(", ");
  if (type === "User") return `This user has history (${list}) and can't be deleted – their work would be deleted too. Disable the login instead.`;
  if (type === "ExchangeRate") return `This rate is used by ${list} and can't be deleted. Correct it instead.`;
  return `This ${TRASHABLE[type].noun} can't be deleted: it is still used by ${list}.`;
}

function assertMayDelete(actor: Actor, type: Trashable, id: string) {
  if (type === "User" && id === actor.id) throw new UserError("You can't delete your own login.");
}

export type DeletePreview = {
  label: string;
  counts: { table: string; noun: string; count: number }[];
  unlinked: { table: string; noun: string; count: number }[];
  payments: { count: number; totalBdt: string };
  invoices: number;
  files: number;
  blocked: string | null;
};

/** Counts for a confirmation page. `root`: leave out this many rows of the record's own type (they are named separately). */
async function summarize(rows: Map<string, Set<string>>, unlinks: Plan["unlinks"], root: { table: string; n: number }) {
  const counts = [...rows]
    .map(([t, ids]) => ({ table: t, count: t === root.table ? ids.size - root.n : ids.size }))
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, noun: tableNoun(c.table, c.count) }))
    .sort((a, b) => a.table.localeCompare(b.table));
  // a link cleared on a row that is deleted anyway isn't "kept"
  const un = new Map<string, Set<string>>();
  for (const u of unlinks) if (!rows.get(u.table)?.has(u.id)) un.set(u.table, (un.get(u.table) ?? new Set()).add(u.id));
  const payIds = [...(rows.get("Payment") ?? [])];
  const pay = payIds.length
    ? await prisma.$queryRawUnsafe<{ total: string }[]>(`select coalesce(sum("amountBdt"), 0)::text as total from "Payment" where id = any($1::text[])`, payIds)
    : [{ total: "0" }];
  return {
    counts,
    unlinked: [...un].map(([t, ids]) => ({ table: t, noun: tableNoun(t, ids.size), count: ids.size })),
    payments: { count: payIds.length, totalBdt: pay[0].total },
    invoices: rows.get("Invoice")?.size ?? 0,
    files: (rows.get("Attachment")?.size ?? 0) + (rows.get("GeneratedDocument")?.size ?? 0),
  };
}

/** What deleting this record would remove (for the confirmation page). */
export async function previewDelete(actor: Actor, type: Trashable, id: string): Promise<DeletePreview> {
  assertCan(actor.role, "record:delete");
  assertMayDelete(actor, type, id);
  const p = await plan(prisma, type, id);
  return {
    label: p.label,
    ...(await summarize(p.rows, p.unlinks, { table: type, n: 1 })),
    blocked: p.blockers.length ? blockMessage(type, p.blockers) : null,
  };
}

/** Records selected on a list at one time. */
export const BULK_MAX = 200;

function bulkIds(ids: string[]): string[] {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) throw new UserError("Select at least one record.");
  if (list.length > BULK_MAX) throw new UserError(`Select at most ${BULK_MAX} records at a time.`);
  return list;
}

export type BulkPreview = Omit<DeletePreview, "label" | "blocked"> & {
  /** Every selected record; `skipped` says why one can't be deleted (the others still are). */
  items: { id: string; label: string; skipped: string | null }[];
};

/** What deleting the selected records would remove, all together (for the bulk confirmation page). */
export async function previewBulkDelete(actor: Actor, type: Trashable, ids: string[]): Promise<BulkPreview> {
  assertCan(actor.role, "record:delete");
  const rows = new Map<string, Set<string>>();
  const unlinks: Plan["unlinks"] = [];
  const items: BulkPreview["items"] = [];
  for (const id of bulkIds(ids)) {
    try {
      assertMayDelete(actor, type, id);
      const p = await plan(prisma, type, id);
      if (p.blockers.length) {
        items.push({ id, label: p.label, skipped: blockMessage(type, p.blockers) });
        continue;
      }
      items.push({ id, label: p.label, skipped: null });
      for (const [t, set] of p.rows) for (const x of set) rows.set(t, (rows.get(t) ?? new Set()).add(x));
      unlinks.push(...p.unlinks);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      items.push({ id, label: await label(prisma, type, id).catch(() => `This ${TRASHABLE[type].noun}`), skipped: e.message });
    }
  }
  const selected = items.filter((i) => !i.skipped && rows.get(type)?.has(i.id)).length;
  return { items, ...(await summarize(rows, unlinks, { table: type, n: selected })) };
}

/**
 * Move the selected records to Trash, one Trash entry each (so each can be
 * restored on its own). Records that can't be deleted are skipped with the reason.
 */
export async function moveManyToTrash(actor: Actor, type: Trashable, ids: string[]): Promise<{ moved: number; skipped: { label: string; reason: string }[] }> {
  assertCan(actor.role, "record:delete");
  let moved = 0;
  const skipped: { label: string; reason: string }[] = [];
  for (const id of bulkIds(ids)) {
    try {
      await moveToTrash(actor, type, id);
      moved += 1;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      if (e.message === GONE) continue; // already deleted (e.g. with another selected record)
      skipped.push({ label: await label(prisma, type, id).catch(() => `This ${TRASHABLE[type].noun}`), reason: e.message });
    }
  }
  return { moved, skipped };
}

// ---------------------------------------------------------------------------
// Delete, restore, delete forever

const TX = { timeout: 60_000, maxWait: 10_000 };

/** Move a record and everything that belongs to it to Trash. Returns the trash item id. */
export async function moveToTrash(actor: Actor, type: Trashable, id: string): Promise<string> {
  assertCan(actor.role, "record:delete");
  return prisma.$transaction(async (tx) => {
    assertMayDelete(actor, type, id);
    if (type === "User") {
      const u = await tx.user.findUniqueOrThrow({ where: { id } });
      if (u.role === "ADMIN" && u.active && (await tx.user.count({ where: { role: "ADMIN", active: true } })) <= 1) {
        throw new UserError("There must always be at least one active Admin.");
      }
    }
    const fks = await foreignKeys(tx);
    const p = await plan(tx, type, id);
    if (p.blockers.length) throw new UserError(blockMessage(type, p.blockers));

    const files = [
      ...(await filesOf(tx, "Attachment", p.rows.get("Attachment"))),
      ...(await filesOf(tx, "GeneratedDocument", p.rows.get("GeneratedDocument"))),
    ];
    const summary = Object.fromEntries([...p.rows].map(([t, ids]) => [t, ids.size]));
    const item = await tx.trashItem.create({
      data: { entityType: type, entityId: id, label: p.label, summary, rows: {}, unlinks: p.unlinks as Prisma.InputJsonValue, files, deletedById: actor.id },
    });
    // Copy the rows inside the database, so Decimal values are kept exactly.
    for (const [table, ids] of p.rows) {
      await tx.$executeRawUnsafe(
        `update "TrashItem" set rows = rows || jsonb_build_object($2::text, (select jsonb_agg(to_jsonb(t)) from ${q(table)} t where t.id = any($3::text[]))) where id = $1`,
        item.id,
        table,
        [...ids],
      );
    }
    for (const u of p.unlinks) {
      await tx.$executeRawUnsafe(`update ${q(u.table)} set ${q(u.column)} = null where id = $1`, u.id);
    }
    for (const table of insertOrder(fks, p.rows.keys()).reverse()) {
      await tx.$executeRawUnsafe(`delete from ${q(table)} where id = any($1::text[])`, [...p.rows.get(table)!]);
    }
    await logChanges(tx, {
      entityType: type,
      entityId: id,
      userId: actor.id,
      action: "DELETE",
      changes: [{ field: "movedToTrash", oldValue: null, newValue: { label: p.label, summary } }],
    });
    return item.id;
  }, TX);
}

async function filesOf(db: Db, table: "Attachment" | "GeneratedDocument", ids: Set<string> | undefined): Promise<string[]> {
  if (!ids?.size) return [];
  const rows = await db.$queryRawUnsafe<{ key: string }[]>(`select "storageKey" as key from ${q(table)} where id = any($1::text[])`, [...ids]);
  return rows.map((r) => r.key);
}

/** Error code from Postgres, also when it comes through the driver adapter. */
function pgCode(e: unknown): string | null {
  const s = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? {})}` : String(e);
  return /23505|unique constraint/i.test(s) ? "23505" : /23503|foreign key/i.test(s) ? "23503" : null;
}

/** Put a trashed record back exactly as it was. Returns where to open it (if it has a page). */
export async function restoreFromTrash(actor: Actor, trashId: string): Promise<{ type: string; id: string; href: string | null }> {
  assertCan(actor.role, "record:delete");
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.trashItem.findUnique({ where: { id: trashId }, select: { id: true, entityType: true, entityId: true, label: true, unlinks: true } });
      if (!item) throw new UserError("This item is no longer in Trash.");
      const fks = await foreignKeys(tx);
      const tablesRow = await tx.$queryRawUnsafe<{ t: string }[]>(`select jsonb_object_keys(rows) as t from "TrashItem" where id = $1`, trashId);
      const tables = tablesRow.map((r) => r.t);
      const ids = new Map<string, Set<string>>();
      for (const t of tables) {
        const r = await tx.$queryRawUnsafe<{ id: string }[]>(`select e->>'id' as id from "TrashItem" ti, jsonb_array_elements(ti.rows->$2::text) e where ti.id = $1`, trashId, t);
        ids.set(t, new Set(r.map((x) => x.id)));
      }

      // Everything a required link points to must exist (or come back with this item).
      for (const fk of fks) {
        if (!fk.required || !ids.has(fk.child)) continue;
        const missing = await tx.$queryRawUnsafe<{ v: string }[]>(
          `select distinct e->>$3::text as v from "TrashItem" ti, jsonb_array_elements(ti.rows->$2::text) e
           where ti.id = $1 and not exists (select 1 from ${q(fk.parent)} p where p.id = e->>$3::text)`,
          trashId,
          fk.child,
          fk.column,
        );
        const gone = missing.filter((m) => !ids.get(fk.parent)?.has(m.v));
        if (!gone.length) continue;
        const holder = await tx.$queryRawUnsafe<{ label: string }[]>(
          `select label from "TrashItem" where id <> $1 and rows->$2::text @> jsonb_build_array(jsonb_build_object('id', $3::text)) limit 1`,
          trashId,
          fk.parent,
          gone[0].v,
        );
        throw new UserError(
          holder.length
            ? `“${item.label}” belongs to “${holder[0].label}”, which is also in Trash. Restore that first.`
            : `“${item.label}” can't be restored: a ${tableNoun(fk.parent, 1)} it belongs to was deleted forever.`,
        );
      }

      const order = insertOrder(fks, tables);
      const optional = (t: string) => fks.filter((f) => f.child === t && !f.required).map((f) => f.column);
      // 1) insert the rows without their optional links (they may point at rows not inserted yet)
      for (const t of order) {
        await tx.$executeRawUnsafe(
          `insert into ${q(t)} select * from jsonb_populate_recordset(null::${q(t)},
             (select jsonb_agg(e - $2::text[]) from "TrashItem" ti, jsonb_array_elements(ti.rows->$3::text) e where ti.id = $1))`,
          trashId,
          optional(t),
          t,
        );
      }
      // 2) put the optional links back where the linked row exists
      for (const t of order) {
        for (const f of fks.filter((x) => x.child === t && !x.required)) {
          await tx.$executeRawUnsafe(
            `update ${q(t)} x set ${q(f.column)} = j.${q(f.column)}
             from jsonb_populate_recordset(null::${q(t)}, (select rows->$2::text from "TrashItem" where id = $1)) j
             where x.id = j.id and j.${q(f.column)} is not null and exists (select 1 from ${q(f.parent)} p where p.id = j.${q(f.column)})`,
            trashId,
            t,
          );
        }
      }
      // 3) re-link rows that stayed (e.g. orders back into their weekly shipment)
      for (const u of item.unlinks as Plan["unlinks"]) {
        await tx.$executeRawUnsafe(`update ${q(u.table)} set ${q(u.column)} = $1 where id = $2 and ${q(u.column)} is null`, u.value, u.id);
      }
      await tx.trashItem.delete({ where: { id: trashId } });
      await logChanges(tx, {
        entityType: item.entityType,
        entityId: item.entityId,
        userId: actor.id,
        action: "CREATE",
        changes: [{ field: "restoredFromTrash", oldValue: null, newValue: item.label }],
      });
      const def = isTrashable(item.entityType) ? TRASHABLE[item.entityType] : null;
      return { type: item.entityType, id: item.entityId, href: def?.href ? def.href(item.entityId) : null };
    }, TX);
  } catch (e) {
    const code = pgCode(e);
    if (code === "23505") throw new UserError("Can't restore: a record with the same number, code or login now exists. Change or delete that one first.");
    if (code === "23503") throw new UserError("Can't restore: something it is linked to was deleted. Restore that first.");
    throw e;
  }
}

/**
 * Restore the selected Trash items. Items that need another selected one back
 * first (a request and its customer) are retried until nothing more can be restored.
 */
export async function restoreManyFromTrash(actor: Actor, trashIds: string[]): Promise<{ restored: number; failed: { label: string; reason: string }[] }> {
  assertCan(actor.role, "record:delete");
  let pending = bulkIds(trashIds);
  const labels = new Map((await prisma.trashItem.findMany({ where: { id: { in: pending } }, select: { id: true, label: true } })).map((i) => [i.id, i.label]));
  const reasons = new Map<string, string>();
  let restored = 0;
  while (pending.length) {
    const next: string[] = [];
    for (const id of pending) {
      try {
        await restoreFromTrash(actor, id);
        restored += 1;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        reasons.set(id, e.message);
        next.push(id);
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return { restored, failed: pending.map((id) => ({ label: labels.get(id) ?? "An item", reason: reasons.get(id) ?? "" })) };
}

/** Delete trashed items for good, with their uploaded files. No ids = empty the whole Trash. */
export async function deleteForever(actor: Actor, trashIds?: string[]): Promise<number> {
  assertCan(actor.role, "record:delete");
  const where = trashIds ? { id: { in: trashIds } } : {};
  const items = await prisma.trashItem.findMany({ where, select: { id: true, entityType: true, entityId: true, label: true, files: true } });
  if (!items.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.trashItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    for (const i of items) {
      await logChanges(tx, {
        entityType: i.entityType,
        entityId: i.entityId,
        userId: actor.id,
        action: "DELETE",
        changes: [{ field: "deletedForever", oldValue: i.label, newValue: null }],
      });
    }
  });
  for (const i of items) for (const key of i.files as string[]) await deleteStoredFile(key);
  return items.length;
}

/** Trash list for Admin. */
export async function listTrash(actor: Actor) {
  assertCan(actor.role, "record:delete");
  return prisma.trashItem.findMany({
    orderBy: { deletedAt: "desc" },
    select: { id: true, entityType: true, label: true, summary: true, files: true, deletedAt: true, deletedBy: { select: { name: true } } },
  });
}
