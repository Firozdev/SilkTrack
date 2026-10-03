"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { dayFromYmd } from "@/lib/dates";
import { fields, zBool, zDec, zDecOpt, zStrOpt, zYmd, zYmdOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { createShipment, setFreight, setShipmentStatus, updateShipmentDetails } from "@/server/shipments";

const STATUSES = ["UPCOMING", "OPEN", "CLOSED", "DEPARTED", "IN_TRANSIT", "ARRIVED_BD", "CUSTOMS_CLEARED", "COMPLETED"] as const;

export const createShipmentAction = formAction(async (fd) => {
  const user = await requireUser();
  const i = z
    .object({
      method: z.enum(["AIR", "SEA"]),
      cutoffDate: zYmd,
      plannedDepartureDate: zYmdOpt,
      etaBd: zYmdOpt,
      forwarder: zStrOpt,
      masterTrackingNo: zStrOpt,
      maxWeightKg: zDecOpt,
      maxCbm: zDecOpt,
      notes: zStrOpt,
      openNow: zBool,
    })
    .parse(fields(fd));
  const day = (v?: string) => (v ? dayFromYmd(v) : undefined);
  const s = await createShipment(user, { ...i, cutoffDate: dayFromYmd(i.cutoffDate), plannedDepartureDate: day(i.plannedDepartureDate), etaBd: day(i.etaBd) });
  redirect(`/shipments/${s.id}`);
});

export const statusAction = formAction(async (fd) => {
  const user = await requireUser();
  const { id, status } = z.object({ id: z.string(), status: z.enum(STATUSES) }).parse(fields(fd));
  await setShipmentStatus(user, id, status);
  revalidatePath(`/shipments/${id}`);
  return { ok: true, message: "Status updated for the shipment and every order in it." };
});

export const detailsAction = formAction(async (fd) => {
  const user = await requireUser();
  const d = z
    .object({
      id: z.string(),
      cutoffDate: zYmd,
      plannedDepartureDate: zYmdOpt,
      etaBd: zYmdOpt,
      forwarder: zStrOpt,
      masterTrackingNo: zStrOpt,
      maxWeightKg: zDecOpt,
      maxCbm: zDecOpt,
      notes: zStrOpt,
    })
    .parse(fields(fd));
  const day = (v?: string) => (v ? dayFromYmd(v) : undefined);
  await updateShipmentDetails(user, d.id, { ...d, cutoffDate: dayFromYmd(d.cutoffDate), plannedDepartureDate: day(d.plannedDepartureDate), etaBd: day(d.etaBd) });
  revalidatePath(`/shipments/${d.id}`);
  return { ok: true, message: "Saved." };
});

export const freightAction = formAction(async (fd) => {
  const user = await requireUser();
  const f = z.object({ id: z.string(), chargeableWeightKg: zDecOpt, freightCost: zDec, freightCurrency: z.enum(["BDT", "RMB"]) }).parse(fields(fd));
  await setFreight(user, f.id, f);
  revalidatePath(`/shipments/${f.id}`);
  return { ok: true, message: "Freight saved and split across items." };
});
