import "server-only";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { docNo } from "@/lib/format";
import { BD_STAGES, STAGE_LABEL, isBdStage, nextStage, paymentGateBlocks, previousStage, type BdStage } from "@/lib/order-stages";
import type { EventType } from "@/lib/notifications/rules";
import { notify } from "./notify";
import { amountDue } from "./payment-submissions";
import { setLineStatus } from "./status";
import type { Actor } from "./actor";

/**
 * Admin moves a Buy for Me order through the Bangladesh stages (Bangladesh
 * received → … → Delivered): one step forward, one step back with a reason,
 * or a whole shipment at once. Each change sets every active line, writes the
 * audit log and a timeline step (date, time, user), and tells the customer.
 */

const CUSTOMER_EVENT: Record<BdStage, EventType> = {
  ARRIVED_BD: "ARRIVED_BD",
  CUSTOMS_CLEARED: "CUSTOMS_CLEARED",
  INVOICE_SHARED: "INVOICE_READY",
  PAYMENT_COLLECTED: "PAYMENT_COLLECTED",
  READY_FOR_DELIVERY: "READY_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
};

type Ord = { id: string; number: number; customerId: string; status: OrderStatus; lines: { id: string; status: OrderStatus }[] };

async function loadOrder(id: string): Promise<Ord> {
  const o = await prisma.order.findUnique({ where: { id }, select: { id: true, number: true, customerId: true, status: true, lines: { select: { id: true, status: true } } } });
  if (!o) throw new UserError("Order not found");
  return o;
}

const activeLines = (o: Ord) => o.lines.filter((l) => l.status !== "CANCELLED").map((l) => l.id);

async function move(actor: Actor, o: Ord, to: OrderStatus, message: string) {
  await prisma.$transaction((tx) => setLineStatus(tx, activeLines(o), to, { actorId: actor.id, message }));
}

async function tellCustomer(actor: Actor, o: Ord, to: BdStage) {
  const data: Record<string, string> = {};
  if (to === "INVOICE_SHARED") {
    // Buy for Me has no invoice document yet: tell the balance still due, if any.
    const due = await amountDue(o.customerId, { kind: "order", id: o.id });
    if (due?.due.gt(0)) data.due = due.due.toFixed(2);
  }
  await notify(CUSTOMER_EVENT[to], { order: o, customerId: o.customerId }, data, { userId: actor.id });
}

/** "Move to next status" on the order page. */
export async function advanceOrder(actor: Actor, orderId: string, expected?: OrderStatus) {
  assertCan(actor.role, "bdReceiving:edit");
  const o = await loadOrder(orderId);
  if (expected && o.status !== expected) throw new UserError(`${docNo("order", o.number)} is now ${STAGE_LABEL[o.status as BdStage] ?? o.status.toLowerCase()} – refresh the page`);
  const to = nextStage(o.status);
  if (!to) throw new UserError(o.status === "DELIVERED" ? "Already delivered" : "Only orders in a shipment can move to the Bangladesh stages");
  if (paymentGateBlocks(o.status, to)) throw new UserError("Mark “Customer payment collected” first – Ready for home delivery comes after it");
  await move(actor, o, to, STAGE_LABEL[to]);
  await tellCustomer(actor, o, to);
  return to;
}

/** "Move back one step" – Admin only, with a reason (audit log + staff timeline). */
export async function moveOrderBack(actor: Actor, orderId: string, reason: string) {
  assertCan(actor.role, "bdReceiving:edit");
  const why = reason.trim();
  if (why.length < 3) throw new UserError("Give a reason for moving back");
  const o = await loadOrder(orderId);
  const to = previousStage(o.status);
  if (!to) throw new UserError("Only Bangladesh stages can be moved back");
  await move(actor, o, to, `Moved back to ${STAGE_LABEL[to as BdStage] ?? "In transit"} – reason: ${why}`);
  return to;
}

export type BulkResult = { moved: string[]; skipped: { ref: string; why: string }[] };

/** Shipment page: move every order in the shipment forward to one status. */
export async function bulkMoveShipmentOrders(actor: Actor, shipmentId: string, target: BdStage): Promise<BulkResult> {
  assertCan(actor.role, "bdReceiving:edit");
  if (!isBdStage(target)) throw new UserError("Choose a status");
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, code: true } });
  if (!shipment) throw new UserError("Shipment not found");
  const orders = await prisma.order.findMany({
    where: { lines: { some: { receivingLines: { some: { receiving: { shipmentId, status: { not: "REPACKED" } } } } } } },
    orderBy: { number: "asc" },
    select: { id: true, number: true, customerId: true, status: true, lines: { select: { id: true, status: true } } },
  });
  const res: BulkResult = { moved: [], skipped: [] };
  const rank = (s: OrderStatus) => (s === "IN_SHIPMENT" || s === "IN_TRANSIT" ? -1 : isBdStage(s) ? BD_STAGES.indexOf(s) : null);
  for (const o of orders) {
    const ref = docNo("order", o.number);
    const r = rank(o.status);
    if (r === null) res.skipped.push({ ref, why: o.status === "ON_HOLD" ? "on hold" : o.status === "CANCELLED" ? "cancelled" : `still ${o.status.toLowerCase().replace(/_/g, " ")}` });
    else if (r >= BD_STAGES.indexOf(target)) res.skipped.push({ ref, why: `already ${STAGE_LABEL[o.status as BdStage].toLowerCase()}` });
    else if (paymentGateBlocks(o.status, target)) res.skipped.push({ ref, why: "customer payment not collected yet" });
    else {
      await move(actor, o, target, `${STAGE_LABEL[target]} – ${shipment.code}`);
      await tellCustomer(actor, o, target);
      res.moved.push(ref);
    }
  }
  return res;
}

/** Balance still due, shown as a warning next to "Customer payment collected". */
export async function balanceDue(orderId: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (!o) return null;
  const due = await amountDue(o.customerId, { kind: "order", id: orderId });
  return due && due.due.gt(0) ? due.due : null;
}
