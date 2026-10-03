"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UserError, formAction } from "@/lib/action";
import { dayFromYmd } from "@/lib/dates";
import { fields, files, rows, zDecOpt, zIntMin0, zStrOpt, zYmd, zYmdOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { saveAttachments } from "@/lib/uploads";
import { createPurchase, decidePriceChange, markProblem, markPurchased, markShippedBySupplier, requestUpfrontPayment } from "@/server/purchasing";

const PLATFORMS = ["ALIBABA_1688", "TAOBAO", "ALIBABA", "TMALL", "OTHER"] as const;

export const createPurchaseAction = formAction(async (fd) => {
  const user = await requireUser();
  const h = z
    .object({
      supplierName: z.string().trim().min(1, "required"),
      platform: z.enum(PLATFORMS),
      supplierOrderNo: zStrOpt,
      paymentMethod: zStrOpt,
      domesticShippingRmb: zDecOpt,
      serviceChargeRmb: zDecOpt,
      notes: zStrOpt,
      trackingUrl: z.string().trim().min(1, "Enter the order tracking URL"),
      expectedArrivalAt: zYmd,
    })
    .parse(fields(fd));
  const lines = rows(fd, "l")
    .map((r) => z.object({ orderLineId: z.string(), quantity: zIntMin0, unitPriceRmb: zDecOpt }).parse(r))
    .filter((l) => l.quantity > 0);
  if (lines.some((l) => !l.unitPriceRmb)) throw new UserError("Enter a unit price for every line you are buying");
  const so = await createPurchase(user, { ...h, expectedArrivalAt: dayFromYmd(h.expectedArrivalAt), lines: lines.map((l) => ({ ...l, unitPriceRmb: l.unitPriceRmb! })) });
  const inv = files(fd, "invoice");
  if (inv.length) await saveAttachments(inv, "SUPPLIER_INVOICE", user.id, { supplierOrderId: so.id });
  revalidatePath("/purchasing");
  redirect(`/purchasing/${so.id}`);
});

const withId = (fd: FormData) => z.object({ id: z.string().min(1) }).parse(fields(fd)).id;

export const decideAction = formAction(async (fd) => {
  const user = await requireUser();
  const { purchaseLineId, decision, id } = z.object({ purchaseLineId: z.string(), decision: z.enum(["approve", "reject"]), id: z.string() }).parse(fields(fd));
  await decidePriceChange(user, purchaseLineId, decision === "approve");
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, message: decision === "approve" ? "Approved." : "Rejected." };
});

export const markPurchasedAction = formAction(async (fd) => {
  const user = await requireUser();
  const id = withId(fd);
  const c = z.object({ trackingUrl: z.string().trim().min(1, "Enter the order tracking URL"), expectedArrivalAt: zYmd }).parse(fields(fd));
  await markPurchased(user, id, { trackingUrl: c.trackingUrl, expectedArrivalAt: dayFromYmd(c.expectedArrivalAt) });
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, message: "Marked as purchased." };
});

export const shippedAction = formAction(async (fd) => {
  const user = await requireUser();
  const id = withId(fd);
  const s = z
    .object({ courierName: z.string().trim().min(1, "required"), trackingNo: z.string().trim().min(1, "required"), trackingUrl: zStrOpt, expectedArrivalAt: zYmdOpt })
    .parse(fields(fd));
  await markShippedBySupplier(user, id, { ...s, expectedArrivalAt: s.expectedArrivalAt ? dayFromYmd(s.expectedArrivalAt) : undefined });
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, message: "Supplier shipping saved." };
});

export const problemAction = formAction(async (fd) => {
  const user = await requireUser();
  const id = withId(fd);
  const p = z.object({ status: z.enum(["OUT_OF_STOCK", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER"]), note: zStrOpt }).parse(fields(fd));
  await markProblem(user, id, p.status, p.note);
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, message: "Status updated; lines are back in the purchase queue." };
});

export const invoiceUploadAction = formAction(async (fd) => {
  const user = await requireUser();
  const id = withId(fd);
  await saveAttachments(files(fd, "invoice"), "SUPPLIER_INVOICE", user.id, { supplierOrderId: id });
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, message: "Uploaded." };
});

export const requestUpfrontAction = formAction(async (fd) => {
  const user = await requireUser();
  const { orderId, note } = z.object({ orderId: z.string(), note: zStrOpt }).parse(fields(fd));
  await requestUpfrontPayment(user, orderId, note);
  revalidatePath("/purchasing");
  return { ok: true, message: "Sent to the BD team." };
});
