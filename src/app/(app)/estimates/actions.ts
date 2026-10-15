"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { dayFromYmd } from "@/lib/dates";
import { fields, files, rows, zDec, zDecOpt, zIntMin0, zStrOpt, zYmd } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { addQuoteImages, checkQuoteImages, removeQuoteImages } from "@/server/quote-images";
import {
  approveQuotation,
  rejectQuotation,
  reviseQuotation,
  saveQuotation,
  sendQuotationToCustomer,
  setUnitSellingPrices,
  submitQuotation,
} from "@/server/estimates";
import { prisma } from "@/lib/prisma";
import { D, money } from "@/lib/money";

/** Selling prices are entered per unit and stored as line totals. */
const lineTotal = (unit: string, qty: number) => money(D(unit).mul(qty)).toString();

const optInt = z.preprocess((v) => (v === "" ? undefined : v), zIntMin0.optional());

export const saveQuotationAction = formAction(async (fd) => {
  const user = await requireUser();
  const h = z
    .object({
      orderId: z.string().min(1),
      shippingMethod: z.enum(["AIR", "SEA"]),
      shippingRatePerKgRmb: zDecOpt,
      shippingRatePerCbmRmb: zDecOpt,
      domesticShippingRmb: zDecOpt,
      packingRmb: zDecOpt,
      inspectionRmb: zDecOpt,
      serviceFeeRmb: zDecOpt,
      validUntil: zYmd,
      notes: zStrOpt,
      intent: z.enum(["draft", "submit"]).default("submit"),
    })
    .parse(fields(fd));
  const parsed = rows(fd, "l").map((r) =>
    z
      .object({
        orderLineId: z.string(),
        unitPriceRmb: zDec,
        moq: optInt,
        unitWeightKg: zDecOpt,
        cartonCount: optInt,
        lengthCm: zDecOpt,
        widthCm: zDecOpt,
        heightCm: zDecOpt,
        sellingUnitBdt: zDecOpt,
      })
      .parse(r),
  );
  // Selling prices are entered per unit; stored as line totals (× the order line's quantity).
  const qty = new Map((await prisma.orderLine.findMany({ where: { orderId: h.orderId }, select: { id: true, quantity: true } })).map((l) => [l.id, l.quantity]));
  const lines = parsed.map(({ sellingUnitBdt, ...l }) => ({ ...l, sellingPriceBdt: sellingUnitBdt ? lineTotal(sellingUnitBdt, qty.get(l.orderLineId) ?? 0) : undefined }));
  // Product images per line (optional): checked before anything is saved.
  const images = Object.fromEntries(parsed.map((l) => [l.orderLineId, files(fd, `img.${l.orderLineId}`)]));
  await checkQuoteImages(images);
  const e = await saveQuotation(user, h.orderId, { ...h, validUntil: dayFromYmd(h.validUntil), lines });
  await removeQuoteImages(user, e.id, fd.getAll("removeImage").filter((v): v is string => typeof v === "string"));
  await addQuoteImages(user, e.id, images);
  if (h.intent === "submit") await submitQuotation(user, e.id);
  revalidatePath(`/requests/${h.orderId}`);
  redirect(`/estimates/${e.id}`);
});

const idOf = (fd: FormData) => z.object({ id: z.string().min(1) }).parse(fields(fd)).id;

function step(fn: (u: Awaited<ReturnType<typeof requireUser>>, id: string, fd: FormData) => Promise<unknown>, message: string) {
  return formAction(async (fd) => {
    const user = await requireUser();
    const id = idOf(fd);
    const res = await fn(user, id, fd);
    revalidatePath(`/estimates/${id}`);
    if (res && typeof res === "object" && "id" in res && typeof res.id === "string") redirect(`/estimates/${res.id}`);
    return { ok: true, message };
  });
}

export const submitAction = step((u, id) => submitQuotation(u, id), "Submitted to the Bangladesh team.");
export const sendAction = step((u, id) => sendQuotationToCustomer(u, id), "Sent to customer – request is now Quoted.");
export const approveAction = step((u, id) => approveQuotation(u, id), "Customer approved – the order is in the China purchase queue.");
export const rejectAction = step((u, id) => rejectQuotation(u, id), "Marked as rejected.");
export const reviseAction = step((u, id, fd) => reviseQuotation(u, id, z.string().trim().optional().parse(fd.get("reason") ?? undefined) || undefined), "New version created.");
/** CS enters prices per unit; stored as line totals (unit × the line's quantity from the database). */
export const sellingAction = step(async (u, id, fd) => {
  const lines = rows(fd, "s").map((r) => z.object({ lineId: z.string(), unitPriceBdt: zDec }).parse(r));
  await setUnitSellingPrices(u, id, lines);
}, "Selling prices saved.");
