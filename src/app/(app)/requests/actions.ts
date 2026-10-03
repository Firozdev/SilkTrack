"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, files, rows, zBool, zDec, zDecOpt, zIntMin0, zIntPos, zStrOpt } from "@/lib/forms";
import { splitLinks } from "@/lib/links";
import { requireUser } from "@/lib/session";
import { saveAttachments } from "@/lib/uploads";
import {
  addComment,
  cancelOrder,
  createRequest,
  recordPayment,
  sendToChina,
  setHold,
  updateRequestHeader,
} from "@/server/requests";

const requestSchema = z.object({
  customerId: zStrOpt,
  name: z.string().trim().min(1, "required"),
  phone: z.string().trim().min(6, "required"),
  email: zStrOpt,
  address: z.string().trim().min(1, "required"),
  district: zStrOpt,
  area: zStrOpt,
  shippingMethod: z.enum(["AIR", "SEA"]),
  type: z.preprocess((v) => (v === "AUTO" ? undefined : v), z.enum(["SINGLE", "BULK"]).optional()),
  targetBudgetBdt: zDecOpt,
  customerNotes: zStrOpt,
  specialInstructions: zStrOpt,
  priority: zIntMin0.default(0),
  allowDuplicates: zBool,
});

const lineSchema = z.object({
  _i: z.string(),
  productName: z.string().trim().min(1, "product name is required"),
  color: zStrOpt,
  size: zStrOpt,
  model: zStrOpt,
  quantity: zIntPos,
  notes: zStrOpt,
  links: zStrOpt,
});

export const createRequestAction = formAction(async (fd) => {
  const user = await requireUser();
  const h = requestSchema.parse(fields(fd));
  const lineRows = rows(fd, "lines").map((r) => lineSchema.parse(r));
  const { order } = await createRequest(user, {
    customer: { id: h.customerId, name: h.name, phone: h.phone, email: h.email, address: h.address, district: h.district, area: h.area },
    shippingMethod: h.shippingMethod,
    type: h.type,
    targetBudgetBdt: h.targetBudgetBdt,
    customerNotes: h.customerNotes,
    specialInstructions: h.specialInstructions,
    priority: h.priority,
    allowDuplicates: h.allowDuplicates,
    lines: lineRows.map((l) => ({ ...l, links: splitLinks(l.links) })),
  });
  for (const [i, l] of lineRows.entries()) {
    const imgs = files(fd, `lines.${l._i}.images`);
    if (imgs.length) await saveAttachments(imgs, "PRODUCT_IMAGE", user.id, { orderLineId: order.lines[i].id });
  }
  revalidatePath("/requests");
  redirect(`/requests/${order.id}`);
});

const idOnly = z.object({ orderId: z.string().min(1) });

function simple(fn: (user: Awaited<ReturnType<typeof requireUser>>, orderId: string, fd: FormData) => Promise<unknown>, message: string) {
  return formAction(async (fd) => {
    const user = await requireUser();
    const { orderId } = idOnly.parse(fields(fd));
    await fn(user, orderId, fd);
    revalidatePath(`/requests/${orderId}`);
    return { ok: true, message };
  });
}

export const sendToChinaAction = simple((u, id) => sendToChina(u, id), "Sent to China team.");
export const holdAction = simple((u, id) => setHold(u, id, true), "Order put on hold.");
export const resumeAction = simple((u, id) => setHold(u, id, false), "Order resumed.");
export const cancelAction = simple(
  (u, id, fd) => cancelOrder(u, id, z.string().trim().min(1, "Give a reason").parse(fd.get("reason"))),
  "Order cancelled.",
);

export const paymentAction = simple(async (u, id, fd) => {
  const p = z
    .object({
      type: z.enum(["ADVANCE", "BALANCE", "REFUND"]),
      amountBdt: zDec,
      method: z.enum(["CASH", "BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CARD", "OTHER"]),
      reference: zStrOpt,
      note: zStrOpt,
    })
    .parse(fields(fd));
  await recordPayment(u, id, p);
}, "Payment recorded.");

export const commentAction = simple(async (u, id, fd) => {
  const body = z.string().trim().min(1, "Write a comment").parse(fd.get("body"));
  const c = await addComment(u, id, body);
  const att = files(fd, "files");
  if (att.length) await saveAttachments(att, "OTHER", u.id, { commentId: c.id, orderId: id });
}, "");

export const headerAction = simple(async (u, id, fd) => {
  const h = z
    .object({
      shippingMethod: z.enum(["AIR", "SEA"]),
      type: z.enum(["SINGLE", "BULK"]),
      targetBudgetBdt: zDecOpt,
      customerNotes: zStrOpt,
      specialInstructions: zStrOpt,
      priority: zIntMin0,
    })
    .parse(fields(fd));
  await updateRequestHeader(u, id, h);
}, "Request updated.");

export const lineImagesAction = formAction(async (fd) => {
  const user = await requireUser();
  const { orderId, lineId } = z.object({ orderId: z.string(), lineId: z.string() }).parse(fields(fd));
  await saveAttachments(files(fd, "images"), "PRODUCT_IMAGE", user.id, { orderLineId: lineId });
  revalidatePath(`/requests/${orderId}`);
  return { ok: true };
});
