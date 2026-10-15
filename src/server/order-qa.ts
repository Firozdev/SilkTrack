import "server-only";
import type { Prisma, QaResult } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { logChanges } from "@/lib/audit";
import { docNo } from "@/lib/format";
import { saveAttachments } from "@/lib/uploads";
import { notify } from "./notify";
import type { Actor } from "./actor";

/**
 * Optional QA test for Buy for Me (the customer ticks "QA test required").
 * After the goods reach the China warehouse the order has a QA task; China
 * records Pass / Fail, notes and photos. Until then its parcels can't be put
 * in a shipment. A failed test is flagged to Admin, who decides what to do.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** QA orders with goods at the China warehouse and no result yet (China's to-do list). */
export function qaTodo(db: Db = prisma) {
  return db.order.findMany({
    where: { qaRequested: true, qaResult: null, status: { notIn: ["CANCELLED"] }, lines: { some: { receivingLines: { some: {} } } } },
    orderBy: { requestedAt: "asc" },
    select: { id: true, number: true, customer: { select: { code: true, name: true } }, lines: { select: { productName: true, quantity: true } } },
  });
}

/** Orders among these lines that still need their QA test – their parcels can't ship yet. */
export async function qaBlockingOrders(db: Db, orderLineIds: string[]) {
  if (!orderLineIds.length) return [];
  return db.order.findMany({ where: { qaRequested: true, qaResult: null, lines: { some: { id: { in: orderLineIds } } } }, select: { id: true, number: true } });
}

export function qaBlockedMessage(orders: { number: number }[]) {
  return `Record the QA test for ${orders.map((o) => docNo("order", o.number)).join(", ")} before shipping`;
}

/**
 * When the first parcel of a QA order is received, China gets the QA task.
 * It's a to-do, so the China user who received the parcel is told too.
 */
export async function notifyQaTasks(orderIds: string[]) {
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds }, qaRequested: true, qaResult: null }, select: { id: true, number: true, _count: { select: { notificationEvents: { where: { type: "QA_REQUESTED" } } } } } });
  for (const o of orders) if (o._count.notificationEvents === 0) await notify("QA_REQUESTED", { order: o });
}

export type QaInput = { result: QaResult; notes?: string };

/** China (or Admin) records the result; it can be corrected until the goods are in a shipment. */
export async function recordOrderQa(actor: Actor, orderId: string, input: QaInput, photos: File[] = []) {
  assertCan(actor.role, "receiving:edit");
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, customerId: true, status: true, qaRequested: true, qaResult: true, qaNotes: true, lines: { select: { receivingLines: { select: { receiving: { select: { status: true, shipmentId: true } } } } } } },
  });
  if (!o) throw new UserError("Request not found");
  if (!o.qaRequested) throw new UserError("The customer did not ask for a QA test");
  if (o.status === "CANCELLED") throw new UserError("This order is cancelled");
  const parcels = o.lines.flatMap((l) => l.receivingLines.map((r) => r.receiving));
  if (!parcels.length) throw new UserError("Receive the goods at the China warehouse before the QA test");
  if (parcels.some((p) => p.shipmentId || p.status === "IN_SHIPMENT")) throw new UserError("The goods are already in a shipment – the QA result can't be changed now");
  const notes = input.notes?.trim() || null;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { qaResult: input.result, qaNotes: notes, qaById: actor.id, qaAt: new Date() } });
    await logChanges(tx, {
      entityType: "Order",
      entityId: orderId,
      userId: actor.id,
      action: "UPDATE",
      changes: [
        { field: "qaResult", oldValue: o.qaResult, newValue: input.result },
        ...(o.qaNotes !== notes ? [{ field: "qaNotes", oldValue: o.qaNotes, newValue: notes }] : []),
      ],
    });
  });
  if (photos.length) await saveAttachments(photos, "QA_PHOTO", actor.id, { orderId });
  await notify(input.result === "PASSED" ? "QA_PASSED" : "QA_FAILED", { order: o, customerId: o.customerId }, { notes }, { userId: actor.id });
}
