import "server-only";
import type { OrderStatus, Prisma, TrackingLeg } from "@/generated/prisma/client";
import { logChanges } from "@/lib/audit";

type Tx = Prisma.TransactionClient;

/** Forward order of the main lifecycle (Cancelled / On hold are outside it). */
export const ORDER_FLOW: OrderStatus[] = [
  "REQUESTED",
  "QUOTED",
  "APPROVED",
  "PURCHASED",
  "AT_CHINA_WAREHOUSE",
  "IN_SHIPMENT",
  "IN_TRANSIT",
  "ARRIVED_BD",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

const rank = (s: OrderStatus) => ORDER_FLOW.indexOf(s);

/** Order status = least advanced active line. All cancelled → CANCELLED. */
export function deriveOrderStatus(lineStatuses: OrderStatus[]): OrderStatus {
  const active = lineStatuses.filter((s) => s !== "CANCELLED");
  if (active.length === 0) return lineStatuses.length ? "CANCELLED" : "REQUESTED";
  const inFlow = active.filter((s) => rank(s) >= 0);
  if (inFlow.length === 0) return active[0];
  return inFlow.reduce((min, s) => (rank(s) < rank(min) ? s : min));
}

/** Which tracking leg a status belongs to. */
export function legFor(status: OrderStatus): TrackingLeg {
  if (rank(status) >= rank("ARRIVED_BD") && rank(status) >= 0) return "BD_TO_CUSTOMER";
  if (rank(status) >= rank("IN_SHIPMENT")) return "CHINA_TO_BD";
  return "SUPPLIER_TO_CHINA";
}

type LineStatusOpts = {
  actorId: string | null;
  message: string;
  /** Skip lines that are already at or past `status` in the flow. */
  onlyForward?: boolean;
  leg?: TrackingLeg;
  shipmentId?: string;
  courier?: string | null;
  trackingNo?: string | null;
};

/**
 * Set the status of order lines, writing an audit row and a timeline event for
 * each line that changes, then recompute the parent orders' status.
 */
export async function setLineStatus(tx: Tx, lineIds: string[], status: OrderStatus, opts: LineStatusOpts) {
  if (lineIds.length === 0) return;
  const lines = await tx.orderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, status: true, orderId: true } });
  const changing = lines.filter((l) => {
    if (l.status === status || l.status === "CANCELLED") return false;
    if (opts.onlyForward && rank(l.status) >= 0 && rank(status) >= 0 && rank(l.status) >= rank(status)) return false;
    return true;
  });
  for (const l of changing) {
    await tx.orderLine.update({ where: { id: l.id }, data: { status } });
    await logChanges(tx, {
      entityType: "OrderLine",
      entityId: l.id,
      userId: opts.actorId,
      action: "UPDATE",
      changes: [{ field: "status", oldValue: l.status, newValue: status }],
    });
    await tx.trackingEvent.create({
      data: {
        orderLineId: l.id,
        leg: opts.leg ?? legFor(status),
        status,
        message: opts.message,
        shipmentId: opts.shipmentId,
        courier: opts.courier ?? undefined,
        trackingNo: opts.trackingNo ?? undefined,
        createdById: opts.actorId,
      },
    });
  }
  for (const orderId of new Set(lines.map((l) => l.orderId))) {
    await refreshOrderStatus(tx, orderId, opts.actorId);
  }
}

/** Recompute an order's status from its lines (unless the order is on hold). */
export async function refreshOrderStatus(tx: Tx, orderId: string, actorId: string | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { select: { status: true } } } });
  if (order.status === "ON_HOLD") return;
  const next = deriveOrderStatus(order.lines.map((l) => l.status));
  await setOrderStatus(tx, orderId, order.status, next, actorId);
}

export async function setOrderStatus(tx: Tx, orderId: string, from: OrderStatus, to: OrderStatus, actorId: string | null) {
  if (from === to) return;
  await tx.order.update({ where: { id: orderId }, data: { status: to } });
  await logChanges(tx, {
    entityType: "Order",
    entityId: orderId,
    userId: actorId,
    action: "UPDATE",
    changes: [{ field: "status", oldValue: from, newValue: to }],
  });
}
