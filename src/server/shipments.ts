import "server-only";
import type { Currency, Prisma, ShipmentStatus, ShippingMethod } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, can } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { allocate, D, money, rmbToBdt, sum } from "@/lib/money";
import { CN_TZ, addDays, isoWeek, isoWeekStart, today } from "@/lib/dates";
import { docNo } from "@/lib/format";
import { logChanges, diffFields } from "@/lib/audit";
import { notifyRoles, queueCustomerMessage } from "@/lib/notify";
import { rateForConversion } from "./rates";
import { setLineStatus } from "./status";
import type { Actor } from "./actor";

type Tx = Prisma.TransactionClient;

export const SHIPMENT_FLOW: ShipmentStatus[] = ["UPCOMING", "OPEN", "CLOSED", "DEPARTED", "IN_TRANSIT", "ARRIVED_BD", "CUSTOMS_CLEARED", "COMPLETED"];

/** SHP-2026-W40-A (air) / SHP-2026-W40-S (sea) */
export function shipmentCode(year: number, week: number, method: ShippingMethod): string {
  return `SHP-${year}-W${String(week).padStart(2, "0")}-${method === "AIR" ? "A" : "S"}`;
}

/** Default dates for a week: cut-off Saturday, depart next Monday, ETA +5 days air / +30 sea. */
export function defaultDates(year: number, week: number, method: ShippingMethod) {
  const monday = isoWeekStart(year, week);
  const cutoffDate = addDays(monday, 5);
  const plannedDepartureDate = addDays(monday, 7);
  const etaBd = addDays(plannedDepartureDate, method === "AIR" ? 5 : 30);
  return { cutoffDate, plannedDepartureDate, etaBd };
}

/** Accepting items: Upcoming or Open, and cut-off not yet passed (China calendar day). */
export function isAccepting(s: { status: ShipmentStatus; cutoffDate: Date }, now = new Date()) {
  return (s.status === "UPCOMING" || s.status === "OPEN") && s.cutoffDate.getTime() >= today(CN_TZ, now).getTime();
}

async function createWeek(tx: Tx, year: number, week: number, method: ShippingMethod, status: ShipmentStatus) {
  const code = shipmentCode(year, week, method);
  const existing = await tx.shipment.findUnique({ where: { code } });
  if (existing) return existing;
  return tx.shipment.create({ data: { code, year, weekNumber: week, method, status, ...defaultDates(year, week, method) } });
}

/**
 * Where a newly received item should go: the Open shipment of that method if
 * its cut-off has not passed, else the next Upcoming one (which is opened).
 * Creates this or next week's shipment if none exists.
 */
export async function suggestShipment(tx: Tx, method: ShippingMethod, now = new Date()) {
  const day = today(CN_TZ, now);
  const candidates = await tx.shipment.findMany({
    where: { method, status: { in: ["OPEN", "UPCOMING"] }, cutoffDate: { gte: day } },
    orderBy: [{ cutoffDate: "asc" }],
  });
  const open = candidates.find((s) => s.status === "OPEN");
  if (open) return open;
  if (candidates[0]) {
    return tx.shipment.update({ where: { id: candidates[0].id }, data: { status: "OPEN" } });
  }
  let { year, week } = isoWeek(day);
  if (defaultDates(year, week, method).cutoffDate < day) ({ year, week } = isoWeek(addDays(day, 7)));
  return createWeek(tx, year, week, method, "OPEN");
}

/** Recompute cached totals from the parcels and samples in the shipment. */
export async function recalcTotals(tx: Tx, shipmentId: string) {
  const [items, samples] = await Promise.all([
    tx.receiving.findMany({
      where: { shipmentId, status: { not: "REPACKED" } },
      select: { cartonCount: true, netWeightKg: true, grossWeightKg: true, cbm: true },
    }),
    tx.sample.findMany({ where: { shipmentId, status: { not: "CANCELLED" } }, select: { cartonCount: true, weightKg: true, cbm: true } }),
  ]);
  await tx.shipment.update({
    where: { id: shipmentId },
    data: {
      itemCount: items.length + samples.length,
      cartonCount: items.reduce((a, i) => a + i.cartonCount, 0) + samples.reduce((a, s) => a + (s.cartonCount ?? 1), 0),
      netWeightKg: sum(items.map((i) => i.netWeightKg)),
      grossWeightKg: sum([...items.map((i) => i.grossWeightKg), ...samples.map((s) => s.weightKg)]),
      cbm: sum([...items.map((i) => i.cbm), ...samples.map((s) => s.cbm)]),
    },
  });
}

/** Capacity warning text, or null. */
export function capacityWarning(s: { grossWeightKg: Prisma.Decimal; cbm: Prisma.Decimal; maxWeightKg: Prisma.Decimal | null; maxCbm: Prisma.Decimal | null; code: string }) {
  const over: string[] = [];
  if (s.maxWeightKg && s.grossWeightKg.gt(s.maxWeightKg)) over.push(`${s.grossWeightKg} kg of ${s.maxWeightKg} kg`);
  if (s.maxCbm && s.cbm.gt(s.maxCbm)) over.push(`${s.cbm} m³ of ${s.maxCbm} m³`);
  return over.length ? `${s.code} is over capacity: ${over.join(", ")}` : null;
}

/** Put a parcel into a shipment (or move it between shipments before Closed). */
export async function assignToShipment(tx: Tx, actorId: string, receivingId: string, shipmentId: string, now = new Date()) {
  const rec = await tx.receiving.findUniqueOrThrow({ where: { id: receivingId }, include: { shipment: true, lines: { select: { orderLineId: true } } } });
  if (rec.status === "REPACKED") throw new UserError("This parcel was repacked into another parcel");
  if (rec.shipment && !isAcceptingOrOpen(rec.shipment)) throw new UserError(`${rec.shipment.code} is already ${rec.shipment.status.toLowerCase()} – items can't be moved`);
  const target = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  if (target.method !== rec.shippingMethod) throw new UserError(`${target.code} is a ${target.method.toLowerCase()} shipment; this parcel ships by ${rec.shippingMethod.toLowerCase()}`);
  if (!isAccepting(target, now)) throw new UserError(`${target.code} is not accepting items (status ${target.status.toLowerCase()} or cut-off passed)`);

  await tx.receiving.update({ where: { id: receivingId }, data: { shipmentId, status: "IN_SHIPMENT", freightShareBdt: null } });
  await logChanges(tx, { entityType: "Receiving", entityId: receivingId, userId: actorId, action: "UPDATE", changes: [{ field: "shipment", oldValue: rec.shipment?.code ?? null, newValue: target.code }] });
  if (target.status === "UPCOMING") await tx.shipment.update({ where: { id: target.id }, data: { status: "OPEN" } });
  await recalcTotals(tx, shipmentId);
  if (rec.shipmentId && rec.shipmentId !== shipmentId) await recalcTotals(tx, rec.shipmentId);
  await setLineStatus(tx, rec.lines.map((l) => l.orderLineId), "IN_SHIPMENT", { actorId, message: `Added to shipment ${target.code}`, onlyForward: true, shipmentId });
  return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
}

function isAcceptingOrOpen(s: { status: ShipmentStatus }) {
  return s.status === "UPCOMING" || s.status === "OPEN";
}

export async function moveReceiving(actor: Actor, receivingId: string, shipmentId: string) {
  assertCan(actor.role, "shipment:edit");
  const s = await prisma.$transaction((tx) => assignToShipment(tx, actor.id, receivingId, shipmentId));
  return capacityWarning(s);
}

export async function removeFromShipment(actor: Actor, receivingId: string) {
  assertCan(actor.role, "shipment:edit");
  await prisma.$transaction(async (tx) => {
    const rec = await tx.receiving.findUniqueOrThrow({ where: { id: receivingId }, include: { shipment: true, lines: { select: { orderLineId: true } } } });
    if (!rec.shipment) return;
    if (!isAcceptingOrOpen(rec.shipment)) throw new UserError(`${rec.shipment.code} is closed – items can't be removed`);
    await tx.receiving.update({ where: { id: receivingId }, data: { shipmentId: null, status: "READY_TO_SHIP", freightShareBdt: null } });
    await logChanges(tx, { entityType: "Receiving", entityId: receivingId, userId: actor.id, action: "UPDATE", changes: [{ field: "shipment", oldValue: rec.shipment.code, newValue: null }] });
    await recalcTotals(tx, rec.shipment.id);
    await setLineStatus(tx, rec.lines.map((l) => l.orderLineId), "AT_CHINA_WAREHOUSE", { actorId: actor.id, message: `Removed from shipment ${rec.shipment.code}` });
  });
}

export type NewShipmentInput = {
  method: ShippingMethod;
  /** Last day to add items; the shipment's week is taken from this date. */
  cutoffDate: Date;
  plannedDepartureDate?: Date;
  etaBd?: Date;
  forwarder?: string;
  masterTrackingNo?: string;
  maxWeightKg?: string;
  maxCbm?: string;
  notes?: string;
  /** Accept items right away instead of Upcoming. */
  openNow?: boolean;
};

/** Plan a shipment by hand. Week and code come from the cut-off date; missing dates use the defaults. */
export async function createShipment(actor: Actor, input: NewShipmentInput) {
  assertCan(actor.role, "shipment:edit");
  const { year, week } = isoWeek(input.cutoffDate);
  const code = shipmentCode(year, week, input.method);
  const existing = await prisma.shipment.findUnique({ where: { code } });
  if (existing) throw new UserError(`${code} is already planned for that week`, [{ href: `/shipments/${existing.id}`, label: `Open ${code}` }]);
  const defaults = defaultDates(year, week, input.method);
  const plannedDepartureDate = input.plannedDepartureDate ?? addDays(input.cutoffDate, 2);
  const s = await prisma.shipment.create({
    data: {
      code,
      year,
      weekNumber: week,
      method: input.method,
      status: input.openNow ? "OPEN" : "UPCOMING",
      cutoffDate: input.cutoffDate,
      plannedDepartureDate,
      etaBd: input.etaBd ?? (input.plannedDepartureDate ? addDays(plannedDepartureDate, input.method === "AIR" ? 5 : 30) : defaults.etaBd),
      forwarder: input.forwarder,
      masterTrackingNo: input.masterTrackingNo,
      maxWeightKg: input.maxWeightKg,
      maxCbm: input.maxCbm,
      notes: input.notes,
    },
  });
  await logChanges(prisma, { entityType: "Shipment", entityId: s.id, userId: actor.id, action: "CREATE" });
  return s;
}

export type ShipmentDetailsInput = {
  cutoffDate: Date;
  plannedDepartureDate?: Date;
  etaBd?: Date;
  forwarder?: string;
  masterTrackingNo?: string;
  maxWeightKg?: string;
  maxCbm?: string;
  notes?: string;
};

export async function updateShipmentDetails(actor: Actor, id: string, input: ShipmentDetailsInput) {
  assertCan(actor.role, "shipment:edit");
  const before = await prisma.shipment.findUniqueOrThrow({ where: { id } });
  const data = {
    cutoffDate: input.cutoffDate,
    plannedDepartureDate: input.plannedDepartureDate ?? null,
    etaBd: input.etaBd ?? null,
    forwarder: input.forwarder ?? null,
    masterTrackingNo: input.masterTrackingNo ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    maxCbm: input.maxCbm ?? null,
    notes: input.notes ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const after = await tx.shipment.update({ where: { id }, data });
    await logChanges(tx, {
      entityType: "Shipment",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: diffFields(before, { cutoffDate: after.cutoffDate, etaBd: after.etaBd, masterTrackingNo: after.masterTrackingNo, maxWeightKg: after.maxWeightKg, maxCbm: after.maxCbm }, false),
    });
  });
}

const STATUS_TO_LINE: Partial<Record<ShipmentStatus, "IN_TRANSIT" | "ARRIVED_BD">> = {
  DEPARTED: "IN_TRANSIT",
  IN_TRANSIT: "IN_TRANSIT",
  ARRIVED_BD: "ARRIVED_BD",
};

const STATUS_MESSAGE: Partial<Record<ShipmentStatus, string>> = {
  CLOSED: "Shipment closed (cut-off)",
  DEPARTED: "Departed China",
  IN_TRANSIT: "In transit to Bangladesh",
  ARRIVED_BD: "Arrived in Bangladesh",
  CUSTOMS_CLEARED: "Customs cleared in Bangladesh",
  COMPLETED: "Shipment completed",
};

/**
 * Move a shipment forward one or more steps. Every order line inside gets the
 * matching status and a timeline entry. Closing auto-creates next week's.
 */
export async function setShipmentStatus(actor: Actor, id: string, status: ShipmentStatus, now = new Date()) {
  assertCan(actor.role, "shipment:edit");
  const s = await prisma.shipment.findUniqueOrThrow({ where: { id } });
  const from = SHIPMENT_FLOW.indexOf(s.status);
  const to = SHIPMENT_FLOW.indexOf(status);
  if (to <= from) throw new UserError("Shipment status can only move forward");
  if (to >= SHIPMENT_FLOW.indexOf("DEPARTED") && s.itemCount === 0) throw new UserError("This shipment has no items");
  if (to >= SHIPMENT_FLOW.indexOf("ARRIVED_BD") && !can(actor.role, "bdReceiving:edit")) throw new UserError("Only Admin can mark arrival in Bangladesh");

  const stamp: Prisma.ShipmentUpdateInput = { status };
  if (to >= SHIPMENT_FLOW.indexOf("DEPARTED") && !s.departedAt) stamp.departedAt = now;
  if (to >= SHIPMENT_FLOW.indexOf("ARRIVED_BD") && !s.arrivedAt) stamp.arrivedAt = now;
  if (to >= SHIPMENT_FLOW.indexOf("CUSTOMS_CLEARED") && !s.customsClearedAt) stamp.customsClearedAt = now;
  if (status === "COMPLETED") stamp.completedAt = now;

  const lineIds = (
    await prisma.receivingLine.findMany({ where: { receiving: { shipmentId: id, status: { not: "REPACKED" } } }, select: { orderLineId: true } })
  ).map((l) => l.orderLineId);

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id }, data: stamp });
    await logChanges(tx, { entityType: "Shipment", entityId: id, userId: actor.id, action: "UPDATE", changes: [{ field: "status", oldValue: s.status, newValue: status }] });
    const lineStatus = STATUS_TO_LINE[status] ?? (to > SHIPMENT_FLOW.indexOf("ARRIVED_BD") ? "ARRIVED_BD" : to > SHIPMENT_FLOW.indexOf("IN_TRANSIT") ? "IN_TRANSIT" : undefined);
    const message = `${STATUS_MESSAGE[status] ?? status} – ${s.code}${s.masterTrackingNo ? ` (${s.masterTrackingNo})` : ""}`;
    if (lineStatus) {
      await setLineStatus(tx, lineIds, lineStatus, { actorId: actor.id, message, onlyForward: true, shipmentId: id, leg: "CHINA_TO_BD", trackingNo: s.masterTrackingNo });
    }
    if (status === "CUSTOMS_CLEARED" || status === "CLOSED") {
      for (const orderLineId of new Set(lineIds)) {
        await tx.trackingEvent.create({ data: { orderLineId, leg: "CHINA_TO_BD", message, shipmentId: id, createdById: actor.id } });
      }
    }
    // Samples travelling in this shipment get the same update on their own timeline.
    if (["DEPARTED", "IN_TRANSIT", "ARRIVED_BD", "CUSTOMS_CLEARED"].includes(status)) {
      const samples = await tx.sample.findMany({ where: { shipmentId: id, status: "SHIPPED" }, select: { id: true } });
      for (const smp of samples) await tx.sampleEvent.create({ data: { sampleId: smp.id, message, createdById: actor.id } });
    }
    if (status === "CLOSED" || (from < SHIPMENT_FLOW.indexOf("CLOSED") && to > SHIPMENT_FLOW.indexOf("CLOSED"))) {
      const next = isoWeek(addDays(isoWeekStart(s.year, s.weekNumber), 7));
      const n = await createWeek(tx, next.year, next.week, s.method, "OPEN");
      if (n.status === "UPCOMING") await tx.shipment.update({ where: { id: n.id }, data: { status: "OPEN" } });
    }
  });

  if (status === "ARRIVED_BD") {
    await notifyRoles(["ADMIN", "CS"], { type: "SHIPMENT_ARRIVED", title: `${s.code} arrived in Bangladesh`, body: `${s.itemCount} parcel(s) to receive.` });
    const orders = await prisma.order.findMany({ where: { lines: { some: { id: { in: lineIds } } } }, select: { id: true, number: true, customerId: true } });
    for (const o of orders) {
      await queueCustomerMessage(o.customerId, "WHATSAPP", {
        type: "ARRIVED_BD",
        title: "Arrived in Bangladesh",
        body: `Your order ${docNo("order", o.number)} has arrived in Bangladesh. We will share the final bill and delivery details soon.`,
        orderId: o.id,
      });
    }
  }
  if (status === "DEPARTED") {
    const orders = await prisma.order.findMany({ where: { lines: { some: { id: { in: lineIds } } } }, select: { id: true, number: true, customerId: true } });
    for (const o of orders) {
      await queueCustomerMessage(o.customerId, "WHATSAPP", { type: "SHIPPED_FROM_CHINA", title: "Shipped from China", body: `Your order ${docNo("order", o.number)} has left China (${s.code}).`, orderId: o.id });
    }
  }
}

export type FreightInput = { chargeableWeightKg?: string; freightCost: string; freightCurrency: Currency };

/**
 * Save the shipment's freight and split it across parcels by gross weight
 * (air) or CBM (sea); each parcel's share is split across its lines by qty.
 */
export async function setFreight(actor: Actor, id: string, input: FreightInput) {
  assertCan(actor.role, "shipment:manage");
  const s = await prisma.shipment.findUniqueOrThrow({ where: { id } });
  let rate: Prisma.Decimal | null = null;
  let costBdt = money(input.freightCost);
  if (input.freightCurrency === "RMB") {
    rate = (await rateForConversion()).rateUsed;
    costBdt = rmbToBdt(input.freightCost, rate);
  }
  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id },
      data: { chargeableWeightKg: input.chargeableWeightKg ?? null, freightCost: input.freightCost, freightCurrency: input.freightCurrency, freightRateUsed: rate, freightCostBdt: costBdt },
    });
    await logChanges(tx, {
      entityType: "Shipment",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: diffFields(s, { freightCostBdt: costBdt, freightRateUsed: rate, chargeableWeightKg: input.chargeableWeightKg ? D(input.chargeableWeightKg) : null }),
    });
    await allocateFreight(tx, id);
  });
}

export async function allocateFreight(tx: Tx, shipmentId: string) {
  const s = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  if (!s.freightCostBdt) return;
  const parcels = await tx.receiving.findMany({ where: { shipmentId, status: { not: "REPACKED" } }, include: { lines: true }, orderBy: { number: "asc" } });
  const shares = allocate(s.freightCostBdt, parcels.map((p) => (s.method === "AIR" ? p.grossWeightKg : p.cbm)));
  for (const [i, p] of parcels.entries()) {
    await tx.receiving.update({ where: { id: p.id }, data: { freightShareBdt: shares[i] } });
    const lineShares = allocate(shares[i], p.lines.map((l) => l.quantityReceived));
    for (const [j, l] of p.lines.entries()) {
      await tx.receivingLine.update({ where: { id: l.id }, data: { freightShareBdt: lineShares[j] } });
    }
  }
}

/** Packing list rows grouped by customer. */
export async function packingList(shipmentId: string) {
  const parcels = await prisma.receiving.findMany({
    where: { shipmentId, status: { not: "REPACKED" } },
    orderBy: { number: "asc" },
    include: {
      cartons: true,
      lines: { include: { orderLine: { select: { productName: true, color: true, size: true, model: true, order: { select: { number: true, customer: { select: { code: true, name: true, phone: true, district: true } } } } } } } },
    },
  });
  const samples = await prisma.sample.findMany({
    where: { shipmentId, status: { not: "CANCELLED" } },
    include: { customer: { select: { code: true, name: true, phone: true, district: true } }, order: { select: { number: true } }, lines: true },
  });
  const sampleRows = samples.flatMap((s) =>
    s.lines.map((l) => ({
      customerCode: s.customer.code,
      customerName: s.customer.name,
      phone: s.customer.phone,
      district: s.customer.district ?? "",
      order: s.order ? docNo("order", s.order.number) : "",
      parcel: docNo("sample", s.number),
      cartonMark: "SAMPLE",
      product: [l.productName, l.variant].filter(Boolean).join(" / "),
      qty: l.quantity,
      cartons: s.cartonCount ?? 1,
      grossKg: s.weightKg?.toString() ?? "",
      cbm: s.cbm?.toString() ?? "",
    })),
  );
  return [...sampleRows, ...parcels.flatMap((p) =>
    p.lines.map((l) => ({
      customerCode: l.orderLine.order.customer.code,
      customerName: l.orderLine.order.customer.name,
      phone: l.orderLine.order.customer.phone,
      district: l.orderLine.order.customer.district ?? "",
      order: docNo("order", l.orderLine.order.number),
      parcel: docNo("receiving", p.number),
      cartonMark: p.cartonMark ?? "",
      product: [l.orderLine.productName, l.orderLine.color, l.orderLine.size, l.orderLine.model].filter(Boolean).join(" / "),
      qty: l.quantityReceived,
      cartons: p.cartonCount,
      grossKg: p.grossWeightKg.toString(),
      cbm: p.cbm.toString(),
    })),
  )].sort((a, b) => a.customerCode.localeCompare(b.customerCode) || a.parcel.localeCompare(b.parcel));
}

/** Shipments that can take items now (for "assign to" dropdowns). */
export async function acceptingShipments(method?: ShippingMethod, now = new Date()) {
  const list = await prisma.shipment.findMany({
    where: { status: { in: ["UPCOMING", "OPEN"] }, method },
    orderBy: [{ cutoffDate: "asc" }],
  });
  return list.filter((s) => isAccepting(s, now));
}
