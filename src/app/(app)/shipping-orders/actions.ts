"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, files, rows, zBool, zDec, zDecOpt, zIntMin0, zStrOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { saveAttachments } from "@/lib/uploads";
import {
  assignShippingOrder,
  cancelShippingOrder,
  createShippingOrder,
  deliverShipping,
  dispatchShipping,
  invoiceShipping,
  markShippingInvoiceSent,
  receiveShippingBd,
  receiveShippingChina,
  recordQa,
  recordShippingPayment,
  setShippingHold,
  updateShippingTracking,
} from "@/server/shipping-orders";

type U = Awaited<ReturnType<typeof requireUser>>;
const METHOD = z.enum(["CASH", "BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CARD", "OTHER"]);
const CONDITION = z.enum(["OK", "DAMAGED", "WRONG_ITEM", "SHORT"]);
const cartonSchema = z.object({ lengthCm: zDec, widthCm: zDec, heightCm: zDec, grossWeightKg: zDecOpt });

function step(fn: (u: U, id: string, fd: FormData) => Promise<string | void>, message: string, photoKind: "PACKAGE_PHOTO" | "QA_PHOTO" = "PACKAGE_PHOTO") {
  return formAction(async (fd) => {
    const user = await requireUser();
    const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
    const extra = await fn(user, id, fd);
    const photos = files(fd, "photos");
    if (photos.length) await saveAttachments(photos, photoKind, user.id, { shippingOrderId: id });
    revalidatePath(`/shipping-orders/${id}`);
    return { ok: true, message: extra ? `${message} ${extra}` : message };
  });
}

export const createShippingOrderAction = formAction(async (fd) => {
  const user = await requireUser();
  const h = z
    .object({
      customerId: zStrOpt,
      name: z.string().trim().min(1, "required"),
      phone: z.string().trim().min(6, "required"),
      email: zStrOpt,
      address: z.string().trim().min(1, "required"),
      district: zStrOpt,
      area: zStrOpt,
      shippingMethod: z.enum(["AIR", "SEA"]),
      qaRequested: zBool,
      declaredWeightKg: zDecOpt,
      declaredCbm: zDecOpt,
      customerNotes: zStrOpt,
    })
    .parse(fields(fd));
  const items = rows(fd, "p").map((r) =>
    z.object({ _i: z.string(), productName: z.string().trim().min(1, "product name is required"), description: zStrOpt, quantity: zIntMin0, courierName: zStrOpt, trackingNo: zStrOpt }).parse(r),
  );
  const s = await createShippingOrder(user, {
    customer: { id: h.customerId, name: h.name, phone: h.phone, email: h.email, address: h.address, district: h.district, area: h.area },
    shippingMethod: h.shippingMethod,
    qaRequested: h.qaRequested,
    declaredWeightKg: h.declaredWeightKg,
    declaredCbm: h.declaredCbm,
    customerNotes: h.customerNotes,
    items,
  });
  const photos = files(fd, "photos");
  if (photos.length) await saveAttachments(photos, "PRODUCT_IMAGE", user.id, { shippingOrderId: s.id });
  revalidatePath("/shipping-orders");
  redirect(`/shipping-orders/${s.id}`);
});

export const trackingAction = step(async (u, id, fd) => {
  const items = rows(fd, "t").map((r) => z.object({ itemId: z.string(), courierName: zStrOpt, trackingNo: zStrOpt }).parse(r));
  await updateShippingTracking(u, id, items);
}, "Tracking saved.");

export const receiveChinaAction = step(async (u, id, fd) => {
  const h = z.object({ grossWeightKg: zDecOpt, cartonMark: zStrOpt }).parse(fields(fd));
  const items = rows(fd, "i").map((r) => z.object({ itemId: z.string(), quantityReceived: zIntMin0, condition: CONDITION }).parse(r));
  const cartons = rows(fd, "c").map((r) => cartonSchema.parse(r));
  await receiveShippingChina(u, id, { ...h, items, cartons });
}, "Saved as received at the China warehouse.");

export const qaAction = step(
  async (u, id, fd) => {
    const q = z.object({ result: z.enum(["PASSED", "FAILED"]), notes: zStrOpt }).parse(fields(fd));
    await recordQa(u, id, q);
  },
  "QA result saved.",
  "QA_PHOTO",
);

export const assignAction = step(async (u, id, fd) => {
  const { shipmentId } = z.object({ shipmentId: z.string().min(1) }).parse(fields(fd));
  const { shipment, warning } = await assignShippingOrder(u, id, shipmentId);
  return `In ${shipment.code}.${warning ? ` ⚠ ${warning}` : ""}`;
}, "Shipment saved.");

export const receiveBdAction = step((u, id) => receiveShippingBd(u, id), "Marked as received in Bangladesh.");

export const invoiceAction = step(async (u, id, fd) => {
  const i = z
    .object({ ratePerUnitBdt: zDec, billWeightKg: zDecOpt, billCbm: zDecOpt, qaFeeBdt: zDecOpt, localDeliveryBdt: zDecOpt, otherChargeBdt: zDecOpt, discountBdt: zDecOpt })
    .parse(fields(fd));
  await invoiceShipping(u, id, i);
}, "Invoice saved.");

export const paymentAction = step(async (u, id, fd) => {
  const p = z.object({ amountBdt: zDec, method: METHOD, reference: zStrOpt }).parse(fields(fd));
  await recordShippingPayment(u, id, p);
}, "Payment recorded.");

export const dispatchAction = step(async (u, id, fd) => {
  const d = z.object({ courier: z.enum(["PATHAO", "STEADFAST", "REDX", "OWN_RIDER", "OTHER"]), trackingNo: zStrOpt }).parse(fields(fd));
  await dispatchShipping(u, id, d);
}, "Out for delivery.");

export const deliverAction = step(async (u, id, fd) => {
  const { receiverName } = z.object({ receiverName: zStrOpt }).parse(fields(fd));
  await deliverShipping(u, id, receiverName);
}, "Delivered.", "PACKAGE_PHOTO");

export const holdAction = step(async (u, id, fd) => {
  const h = z.object({ hold: z.enum(["yes", "no"]), reason: zStrOpt }).parse(fields(fd));
  await setShippingHold(u, id, h.hold === "yes", h.reason);
}, "Saved.");

export const cancelAction = step((u, id, fd) => cancelShippingOrder(u, id, z.string().trim().min(1, "Give a reason").parse(fd.get("reason"))), "Shipping order cancelled.");
export const photoAction = step(async () => undefined, "Uploaded.");

export const invoiceSentAction = formAction(async (fd) => {
  const user = await requireUser();
  const { id, channel } = z.object({ id: z.string(), channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]) }).parse(fields(fd));
  await markShippingInvoiceSent(user, id, channel);
  revalidatePath(`/shipping-orders/${id}`);
  return { ok: true, message: "Logged as sent." };
});
