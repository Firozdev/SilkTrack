"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, files, rows, zDec, zDecOpt, zIntMin0, zStrOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { saveAttachments } from "@/lib/uploads";
import { receiveParcel, repack } from "@/server/receiving";
import { moveReceiving, removeFromShipment } from "@/server/shipments";

const CONDITION = z.enum(["OK", "DAMAGED", "WRONG_ITEM", "SHORT"]);
const cartonSchema = z.object({ lengthCm: zDec, widthCm: zDec, heightCm: zDec, grossWeightKg: zDecOpt });
const shipmentField = z.preprocess((v) => (v === "none" ? null : v), z.string().min(1).nullable());

export const receiveAction = formAction(async (fd) => {
  const user = await requireUser();
  const h = z
    .object({
      supplierOrderId: z.string().min(1),
      condition: CONDITION,
      cartonMark: zStrOpt,
      netWeightKg: zDecOpt,
      grossWeightKg: zDec,
      shippingMethod: z.enum(["AIR", "SEA"]),
      shipmentId: shipmentField,
      notes: zStrOpt,
    })
    .parse(fields(fd));
  const lines = rows(fd, "l").map((r) => z.object({ purchaseLineId: z.string(), quantityReceived: zIntMin0, condition: CONDITION }).parse(r));
  const cartons = rows(fd, "c").map((r) => cartonSchema.parse(r));
  const res = await receiveParcel(user, { ...h, lines, cartons });
  const photos = files(fd, "photos");
  if (photos.length) await saveAttachments(photos, "PACKAGE_PHOTO", user.id, { receivingId: res.receiving.id });
  revalidatePath("/receiving");
  redirect(`/receiving/${res.receiving.id}${res.warning ? `?warn=${encodeURIComponent(res.warning)}` : ""}`);
});

export const moveAction = formAction(async (fd) => {
  const user = await requireUser();
  const { receivingId, shipmentId } = z.object({ receivingId: z.string(), shipmentId: z.string() }).parse(fields(fd));
  if (shipmentId === "none") {
    await removeFromShipment(user, receivingId);
  } else {
    const warning = await moveReceiving(user, receivingId, shipmentId);
    revalidatePath(`/receiving/${receivingId}`);
    return { ok: true, message: warning ? `Moved. ⚠ ${warning}` : "Moved." };
  }
  revalidatePath(`/receiving/${receivingId}`);
  return { ok: true, message: "Removed from shipment." };
});

export const repackAction = formAction(async (fd) => {
  const user = await requireUser();
  const ids = fd.getAll("ids").map(String);
  const h = z.object({ grossWeightKg: zDec, netWeightKg: zDecOpt, cartonMark: zStrOpt, shipmentId: shipmentField }).parse(fields(fd));
  const cartons = rows(fd, "c").map((r) => cartonSchema.parse(r));
  const res = await repack(user, ids, { ...h, cartons });
  revalidatePath("/receiving");
  redirect(`/receiving/${res.receiving.id}`);
});

export const photoAction = formAction(async (fd) => {
  const user = await requireUser();
  const { receivingId } = z.object({ receivingId: z.string() }).parse(fields(fd));
  await saveAttachments(files(fd, "photos"), "PACKAGE_PHOTO", user.id, { receivingId });
  revalidatePath(`/receiving/${receivingId}`);
  return { ok: true, message: "Uploaded." };
});
