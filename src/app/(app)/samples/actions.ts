"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { dayFromYmd } from "@/lib/dates";
import { fields, files, rows, zDec, zDecOpt, zIntMin0, zStrOpt, zYmd, zYmdOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { saveAttachments } from "@/lib/uploads";
import { cancelSample, createStandaloneSample, deliverSample, invoiceSample, markSampleInvoiceSent, purchaseSample, receiveSampleBd, recordSamplePayment, requestSample, shipSample } from "@/server/samples";

type U = Awaited<ReturnType<typeof requireUser>>;

function step(fn: (u: U, id: string, fd: FormData) => Promise<unknown>, message: string) {
  return formAction(async (fd) => {
    const user = await requireUser();
    const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
    await fn(user, id, fd);
    const photos = files(fd, "photos");
    if (photos.length) await saveAttachments(photos, "PACKAGE_PHOTO", user.id, { sampleId: id });
    revalidatePath(`/samples/${id}`);
    return { ok: true, message };
  });
}

export const requestSampleAction = formAction(async (fd) => {
  const user = await requireUser();
  const { orderId, note } = z.object({ orderId: z.string(), note: zStrOpt }).parse(fields(fd));
  const lines = rows(fd, "x").map((r) => z.object({ orderLineId: z.string(), quantity: zIntMin0 }).parse(r));
  await requestSample(user, orderId, { lines, note });
  revalidatePath(`/requests/${orderId}`);
  return { ok: true, message: "Sample requested from the China team." };
});

const optInt = z.preprocess((v) => (v === "" ? undefined : v), zIntMin0.optional());
const sizeSchema = z.object({ weightKg: zDecOpt, cartonCount: optInt, lengthCm: zDecOpt, widthCm: zDecOpt, heightCm: zDecOpt });

export const invoiceAction = step(async (u, id, fd) => {
  const f = fields(fd);
  const i = z
    .object({
      productRmb: zDec,
      chinaShippingRmb: zDecOpt,
      shippingToBdRmb: zDecOpt,
      shippingRatePerKgRmb: zDecOpt,
      shippingRatePerCbmRmb: zDecOpt,
      serviceRmb: zDecOpt,
      paymentRequired: z.enum(["yes", "no"]),
    })
    .parse(f);
  await invoiceSample(u, id, { ...i, paymentRequired: i.paymentRequired === "yes", size: sizeSchema.parse(f) });
}, "Sample invoice saved.");

export const paymentAction = step(async (u, id, fd) => {
  const p = z.object({ amountBdt: zDec, method: z.enum(["CASH", "BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CARD", "OTHER"]), reference: zStrOpt }).parse(fields(fd));
  await recordSamplePayment(u, id, p);
}, "Payment recorded.");

export const purchaseAction = step(async (u, id, fd) => {
  const p = z.object({ supplierName: z.string().trim().min(1, "required"), supplierOrderNo: zStrOpt, purchaseTrackingUrl: z.string().trim().min(1, "Enter the order tracking URL"), expectedAtWarehouseAt: zYmd }).parse(fields(fd));
  await purchaseSample(u, id, { ...p, expectedAtWarehouseAt: dayFromYmd(p.expectedAtWarehouseAt) });
}, "Sample purchased.");

export const shipAction = step(async (u, id, fd) => {
  const size = sizeSchema.parse(fields(fd));
  const p = z
    .object({
      shippingMode: z.enum(["WEEKLY_SHIPMENT", "EXPRESS_COURIER", "HAND_CARRY", "POST", "OTHER"]),
      carrierName: zStrOpt,
      trackingNo: zStrOpt,
      trackingUrl: zStrOpt,
      shipmentId: zStrOpt,
      etaBd: zYmdOpt,
    })
    .parse(fields(fd));
  await shipSample(u, id, { ...p, etaBd: p.etaBd ? dayFromYmd(p.etaBd) : undefined, size });
}, "Shipping saved.");

export const receiveAction = step((u, id) => receiveSampleBd(u, id), "Marked as received in Bangladesh.");
export const deliverAction = step(async (u, id, fd) => {
  const d = z
    .object({ feedback: zStrOpt, amountBdt: zDecOpt, method: z.enum(["CASH", "BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CARD", "OTHER"]).optional(), reference: zStrOpt })
    .parse(fields(fd));
  await deliverSample(u, id, d.feedback, d.amountBdt && d.method ? { amountBdt: d.amountBdt, method: d.method, reference: d.reference } : undefined);
}, "Delivered.");
export const cancelAction = step((u, id, fd) => cancelSample(u, id, z.string().trim().min(1, "Give a reason").parse(fd.get("reason"))), "Sample cancelled.");
export const photoAction = step(async () => undefined, "Uploaded.");

export const invoiceSentAction = formAction(async (fd) => {
  const user = await requireUser();
  const { id, channel } = z.object({ id: z.string(), channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]) }).parse(fields(fd));
  await markSampleInvoiceSent(user, id, channel);
  revalidatePath(`/samples/${id}`);
  return { ok: true, message: "Logged as sent." };
});

export const createStandaloneAction = formAction(async (fd) => {
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
      note: zStrOpt,
    })
    .parse(fields(fd));
  const lines = rows(fd, "p").map((r) => z.object({ _i: z.string(), productName: z.string().trim().min(1, "product name is required"), variant: zStrOpt, link: zStrOpt, quantity: zIntMin0 }).parse(r));
  const s = await createStandaloneSample(user, {
    customer: { id: h.customerId, name: h.name, phone: h.phone, email: h.email, address: h.address, district: h.district, area: h.area },
    lines,
    note: h.note,
  });
  const photos = files(fd, "photos");
  if (photos.length) await saveAttachments(photos, "PRODUCT_IMAGE", user.id, { sampleId: s.id });
  revalidatePath("/samples");
  redirect(`/samples/${s.id}`);
});
