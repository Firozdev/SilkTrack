import "server-only";
import type { IssueType, ReceivingCondition, ShippingMethod } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions";
import { UserError } from "@/lib/action";
import { D, cbmOf, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { logChanges } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { setLineStatus } from "./status";
import { allocateFreight, assignToShipment, capacityWarning, recalcTotals, suggestShipment } from "./shipments";
import type { Actor } from "./actor";

/** Supplier orders matching a tracking number, with what is still to receive. */
export async function findByTracking(trackingNo: string) {
  const q = trackingNo.trim();
  if (!q) return [];
  const orders = await prisma.supplierOrder.findMany({
    where: { trackingNo: { contains: q, mode: "insensitive" }, status: { in: ["PURCHASED", "SHIPPED_BY_SUPPLIER", "RECEIVED_AT_CHINA_WAREHOUSE"] } },
    take: 10,
    include: {
      supplier: { select: { name: true } },
      lines: {
        include: {
          receivingLines: { where: { receiving: { status: { not: "REPACKED" } } }, select: { quantityReceived: true } },
          orderLine: { select: { productName: true, color: true, size: true, model: true, order: { select: { number: true, shippingMethod: true, customer: { select: { code: true } } } } } },
        },
      },
    },
  });
  return orders.map((o) => ({
    ...o,
    lines: o.lines.map((l) => ({ ...l, received: l.receivingLines.reduce((a, r) => a + r.quantityReceived, 0) })),
  }));
}

export type CartonInput = { lengthCm: string; widthCm: string; heightCm: string; grossWeightKg?: string; label?: string };

export type ReceiveInput = {
  supplierOrderId: string;
  condition: ReceivingCondition;
  cartonMark?: string;
  netWeightKg?: string;
  grossWeightKg: string;
  cartons: CartonInput[];
  shippingMethod: ShippingMethod;
  /** "auto" = suggested shipment, null = don't assign yet, or a shipment id. */
  shipmentId: string | null;
  notes?: string;
  lines: { purchaseLineId: string; quantityReceived: number; condition: ReceivingCondition }[];
};

const ISSUE_FOR: Record<Exclude<ReceivingCondition, "OK">, IssueType> = { DAMAGED: "DAMAGED", WRONG_ITEM: "WRONG_ITEM", SHORT: "SHORT" };

/** Record a parcel at the China warehouse. */
export async function receiveParcel(actor: Actor, input: ReceiveInput, now = new Date()) {
  assertCan(actor.role, "receiving:edit");
  if (D(input.grossWeightKg).lte(0)) throw new UserError("Gross weight is required");
  if (!input.cartons.length) throw new UserError("Add at least one carton with its dimensions");
  const lines = input.lines.filter((l) => l.quantityReceived > 0);
  if (!lines.length) throw new UserError("Enter the quantity received for at least one line");

  const so = await prisma.supplierOrder.findUnique({
    where: { id: input.supplierOrderId },
    include: { lines: { include: { receivingLines: { where: { receiving: { status: { not: "REPACKED" } } }, select: { quantityReceived: true } } } } },
  });
  if (!so) throw new UserError("Purchase not found");
  const plById = new Map(so.lines.map((l) => [l.id, l]));
  for (const l of lines) {
    const pl = plById.get(l.purchaseLineId);
    if (!pl) throw new UserError("Line does not belong to this purchase");
    const already = pl.receivingLines.reduce((a, r) => a + r.quantityReceived, 0);
    if (already + l.quantityReceived > pl.quantity) throw new UserError(`Receiving more than ordered (${already} already received of ${pl.quantity})`);
  }

  const cartons = input.cartons.map((c) => ({ ...c, cbm: cbmOf(c.lengthCm, c.widthCm, c.heightCm) }));
  const totalCbm = sum(cartons.map((c) => c.cbm));

  const result = await prisma.$transaction(async (tx) => {
    const rec = await tx.receiving.create({
      data: {
        receivedAt: now,
        receivedById: actor.id,
        trackingNo: so.trackingNo,
        supplierOrderId: so.id,
        condition: input.condition,
        status: "READY_TO_SHIP",
        cartonCount: cartons.length,
        cartonMark: input.cartonMark,
        netWeightKg: input.netWeightKg,
        grossWeightKg: input.grossWeightKg,
        cbm: totalCbm,
        shippingMethod: input.shippingMethod,
        notes: input.notes,
        cartons: { create: cartons },
        lines: {
          create: lines.map((l) => ({
            purchaseLineId: l.purchaseLineId,
            orderLineId: plById.get(l.purchaseLineId)!.orderLineId,
            quantityOrdered: plById.get(l.purchaseLineId)!.quantity,
            quantityReceived: l.quantityReceived,
            condition: l.condition,
          })),
        },
      },
    });
    await logChanges(tx, { entityType: "Receiving", entityId: rec.id, userId: actor.id, action: "CREATE" });
    await logChanges(tx, {
      entityType: "Receiving",
      entityId: rec.id,
      userId: actor.id,
      action: "UPDATE",
      changes: [
        { field: "grossWeightKg", oldValue: null, newValue: D(input.grossWeightKg).toString() },
        { field: "cbm", oldValue: null, newValue: totalCbm.toString() },
      ],
    });

    const orderLineIds = lines.map((l) => plById.get(l.purchaseLineId)!.orderLineId);
    await setLineStatus(tx, orderLineIds, "AT_CHINA_WAREHOUSE", { actorId: actor.id, message: `Received at China warehouse (${docNo("receiving", rec.number)})`, onlyForward: true, leg: "SUPPLIER_TO_CHINA" });

    const fully = so.lines.every((pl) => {
      const now = lines.find((l) => l.purchaseLineId === pl.id)?.quantityReceived ?? 0;
      return pl.receivingLines.reduce((a, r) => a + r.quantityReceived, 0) + now >= pl.quantity;
    });
    if (fully && so.status !== "RECEIVED_AT_CHINA_WAREHOUSE") {
      await tx.supplierOrder.update({ where: { id: so.id }, data: { status: "RECEIVED_AT_CHINA_WAREHOUSE" } });
      await logChanges(tx, { entityType: "SupplierOrder", entityId: so.id, userId: actor.id, action: "UPDATE", changes: [{ field: "status", oldValue: so.status, newValue: "RECEIVED_AT_CHINA_WAREHOUSE" }] });
    }

    // Issue tickets back to the purchaser and BD team.
    const issues: { type: IssueType; orderLineId?: string; description: string }[] = [];
    for (const l of lines) {
      if (l.condition !== "OK") {
        const pl = plById.get(l.purchaseLineId)!;
        issues.push({ type: ISSUE_FOR[l.condition], orderLineId: pl.orderLineId, description: `${l.condition.replace("_", " ").toLowerCase()}: received ${l.quantityReceived} of ${pl.quantity}` });
      }
    }
    if (input.condition !== "OK" && issues.length === 0) {
      issues.push({ type: ISSUE_FOR[input.condition], description: `Parcel condition: ${input.condition.replace("_", " ").toLowerCase()}` });
    }
    const orderIds = await tx.orderLine.findMany({ where: { id: { in: orderLineIds } }, select: { id: true, orderId: true } });
    for (const i of issues) {
      await tx.issue.create({
        data: {
          type: i.type,
          source: "CHINA_RECEIVING",
          receivingId: rec.id,
          orderLineId: i.orderLineId,
          orderId: orderIds.find((o) => o.id === i.orderLineId)?.orderId ?? orderIds[0]?.orderId,
          description: [i.description, input.notes].filter(Boolean).join(" – "),
          reportedById: actor.id,
          assignedToId: so.purchasedById,
        },
      });
    }

    let shipment = null;
    if (input.shipmentId) {
      const target = input.shipmentId === "auto" ? await suggestShipment(tx, input.shippingMethod, now) : { id: input.shipmentId };
      shipment = await assignToShipment(tx, actor.id, rec.id, target.id, now);
    }
    return { rec, shipment, issueCount: issues.length, orderIds: [...new Set(orderIds.map((o) => o.orderId))] };
  });

  const nums = await prisma.order.findMany({ where: { id: { in: result.orderIds } }, select: { number: true } });
  await notifyRoles(["CS"], {
    type: "RECEIVED_IN_CHINA",
    title: `Received in China: ${nums.map((n) => docNo("order", n.number)).join(", ")}`,
    body: `${docNo("receiving", result.rec.number)}${result.shipment ? ` → ${result.shipment.code}` : ""}`,
    orderId: result.orderIds[0],
  });
  if (result.issueCount) {
    await notifyRoles(["CS", "PURCHASE", "ADMIN"], { type: "ISSUE_REPORTED", title: `Issue at China warehouse: ${docNo("receiving", result.rec.number)}`, body: `${result.issueCount} problem(s) reported on receiving.`, orderId: result.orderIds[0] }, actor.id);
  }
  return { receiving: result.rec, shipment: result.shipment, warning: result.shipment ? capacityWarning(result.shipment) : null };
}

/** Merge several ready parcels into one carton set with new weight / CBM. */
export async function repack(
  actor: Actor,
  receivingIds: string[],
  input: { cartons: CartonInput[]; grossWeightKg: string; netWeightKg?: string; cartonMark?: string; shipmentId: string | null },
  now = new Date(),
) {
  assertCan(actor.role, "receiving:edit");
  if (receivingIds.length < 2) throw new UserError("Select at least two parcels to repack");
  if (!input.cartons.length) throw new UserError("Add the new carton dimensions");
  const parcels = await prisma.receiving.findMany({ where: { id: { in: receivingIds } }, include: { lines: true, shipment: true } });
  if (parcels.length !== receivingIds.length) throw new UserError("Parcel not found");
  const methods = new Set(parcels.map((p) => p.shippingMethod));
  if (methods.size > 1) throw new UserError("Parcels for air and sea can't be repacked together");
  for (const p of parcels) {
    if (p.status === "REPACKED") throw new UserError(`${docNo("receiving", p.number)} was already repacked`);
    if (p.shipment && !["UPCOMING", "OPEN"].includes(p.shipment.status)) throw new UserError(`${docNo("receiving", p.number)} is in a closed shipment`);
  }
  const cartons = input.cartons.map((c) => ({ ...c, cbm: cbmOf(c.lengthCm, c.widthCm, c.heightCm) }));

  return prisma.$transaction(async (tx) => {
    const merged = await tx.receiving.create({
      data: {
        receivedAt: now,
        receivedById: actor.id,
        condition: parcels.every((p) => p.condition === "OK") ? "OK" : parcels.find((p) => p.condition !== "OK")!.condition,
        status: "READY_TO_SHIP",
        cartonCount: cartons.length,
        cartonMark: input.cartonMark,
        netWeightKg: input.netWeightKg,
        grossWeightKg: input.grossWeightKg,
        cbm: sum(cartons.map((c) => c.cbm)),
        shippingMethod: parcels[0].shippingMethod,
        notes: `Repacked from ${parcels.map((p) => docNo("receiving", p.number)).join(", ")}`,
        cartons: { create: cartons },
        lines: {
          create: parcels.flatMap((p) =>
            p.lines.map((l) => ({ orderLineId: l.orderLineId, purchaseLineId: l.purchaseLineId, quantityOrdered: l.quantityOrdered, quantityReceived: l.quantityReceived, condition: l.condition })),
          ),
        },
      },
    });
    const oldShipments = new Set(parcels.map((p) => p.shipmentId).filter((x): x is string => !!x));
    await tx.receiving.updateMany({ where: { id: { in: receivingIds } }, data: { status: "REPACKED", repackedIntoId: merged.id, shipmentId: null, freightShareBdt: null } });
    await logChanges(tx, { entityType: "Receiving", entityId: merged.id, userId: actor.id, action: "CREATE" });
    for (const sid of oldShipments) await recalcTotals(tx, sid);
    let shipment = null;
    if (input.shipmentId) {
      const target = input.shipmentId === "auto" ? await suggestShipment(tx, parcels[0].shippingMethod, now) : { id: input.shipmentId };
      shipment = await assignToShipment(tx, actor.id, merged.id, target.id, now);
      await allocateFreight(tx, target.id);
    }
    return { receiving: merged, shipment };
  });
}

export async function listReceivings(status?: "READY_TO_SHIP" | "IN_SHIPMENT" | "REPACKED" | "ON_HOLD") {
  return prisma.receiving.findMany({
    where: status ? { status } : undefined,
    orderBy: { receivedAt: "desc" },
    take: 200,
    include: {
      shipment: { select: { id: true, code: true, status: true } },
      receivedBy: { select: { name: true } },
      lines: { select: { quantityReceived: true, orderLine: { select: { productName: true, order: { select: { id: true, number: true, customer: { select: { code: true } } } } } } } },
    },
  });
}

/**
 * Packaging estimate from the customer-approved quotation for the lines being
 * received, used to prefill the receiving form. Cartons are scaled when only
 * part of a line is received. Returns null when no quotation has sizes.
 */
export async function estimatedPackaging(lines: { orderLineId: string; quantity: number }[]) {
  if (!lines.length) return null;
  const est = await prisma.estimateLine.findMany({
    where: { orderLineId: { in: lines.map((l) => l.orderLineId) }, estimate: { status: { in: ["APPROVED", "SENT_TO_CUSTOMER", "REVIEWED_BY_BD", "SUBMITTED_BY_CHINA"] } } },
    orderBy: { estimate: { version: "desc" } },
    include: { estimate: { select: { number: true, status: true } } },
  });
  // Prefer the approved quotation, then the latest version.
  const pick = new Map<string, (typeof est)[number]>();
  for (const e of est) {
    const cur = pick.get(e.orderLineId!);
    if (!cur || (cur.estimate.status !== "APPROVED" && e.estimate.status === "APPROVED")) pick.set(e.orderLineId!, e);
  }
  const cartons: { lengthCm: string; widthCm: string; heightCm: string; grossWeightKg?: string }[] = [];
  let weight = D(0);
  const sources = new Set<number>();
  for (const l of lines) {
    const e = pick.get(l.orderLineId);
    if (!e || l.quantity <= 0) continue;
    sources.add(e.estimate.number);
    if (e.unitWeightKg) weight = weight.add(e.unitWeightKg.mul(l.quantity));
    if (e.cartonCount > 0 && e.lengthCm && e.widthCm && e.heightCm) {
      const n = Math.max(1, Math.ceil((e.cartonCount * l.quantity) / e.quantity));
      const perCarton = e.unitWeightKg ? e.unitWeightKg.mul(l.quantity).div(n).toDecimalPlaces(3) : null;
      for (let i = 0; i < n; i++) {
        cartons.push({ lengthCm: e.lengthCm.toString(), widthCm: e.widthCm.toString(), heightCm: e.heightCm.toString(), grossWeightKg: perCarton?.toString() });
      }
    }
  }
  if (!sources.size) return null;
  const cbm = sum(cartons.map((c) => cbmOf(c.lengthCm, c.widthCm, c.heightCm)));
  return { cartons, grossWeightKg: weight.toDecimalPlaces(3), cbm, estimates: [...sources] };
}
