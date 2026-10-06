"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formAction, type ActionState } from "@/lib/action";
import { fields, files, rows, zBool, zDecOpt, zIntMin0, zIntPos, zStrOpt, zYmd } from "@/lib/forms";
import { dayFromYmd } from "@/lib/dates";
import { submitPayment } from "@/server/payment-submissions";
import { confirmReceipt } from "@/server/receipts";
import { saveItemFiles } from "@/server/line-files";
import { splitLinks } from "@/lib/links";
import { prisma } from "@/lib/prisma";
import { saveAttachments } from "@/lib/uploads";
import { endPortalSession, getPortalAccount, requirePortalAccount, startPortalSession } from "@/lib/portal-session";
import { authenticate, resetPassword, signUp } from "@/server/portal-auth";
import { decidePortalQuotation } from "@/server/estimates";
import { createPortalRequest } from "@/server/requests";
import { createPortalShippingOrder, updatePortalShippingTracking } from "@/server/shipping-orders";
import { UserError } from "@/lib/action";
import { DICTS, translateError, type Dict, type Lang } from "./i18n";
import { getLang, setLangCookie } from "./lang";

/** formAction whose error / message text is shown in the customer's language. */
function portalAction(fn: (fd: FormData, t: Dict, lang: Lang) => Promise<ActionState | void>) {
  const inner = formAction(async (fd) => {
    const lang = await getLang();
    return fn(fd, DICTS[lang], lang);
  });
  return async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const res = await inner(prev, fd);
    const lang = await getLang();
    return { ...res, error: translateError(lang, res.error) };
  };
}

const fileKind = (f: File) => (f.type.startsWith("image/") ? "PRODUCT_IMAGE" : "OTHER");
async function saveCustomerFiles(list: File[], accountId: string, owner: { orderId?: string; orderLineId?: string; shippingOrderId?: string }) {
  for (const kind of ["PRODUCT_IMAGE", "OTHER"] as const) {
    const part = list.filter((f) => fileKind(f) === kind);
    if (part.length) await saveAttachments(part, kind, { accountId }, owner);
  }
}

export async function setLangAction(fd: FormData) {
  const lang: Lang = fd.get("lang") === "bn" ? "bn" : "en";
  await setLangCookie(lang);
  const acc = await getPortalAccount();
  if (acc) await prisma.portalAccount.update({ where: { id: acc.id }, data: { locale: lang === "bn" ? "BN" : "EN" } });
  const back = String(fd.get("back") ?? "/portal");
  redirect(back.startsWith("/portal") && !back.startsWith("//") ? back : "/portal");
}

export const portalLoginAction = portalAction(async (fd) => {
  const { phone, password } = z.object({ phone: z.string(), password: z.string() }).parse(fields(fd));
  const res = await authenticate(phone, password);
  if (!res.ok) return { error: res.error };
  await startPortalSession(res.accountId);
  const acc = await prisma.portalAccount.findUniqueOrThrow({ where: { id: res.accountId }, select: { locale: true } });
  await setLangCookie(acc.locale === "BN" ? "bn" : "en");
  redirect("/portal");
});

export const portalSignUpAction = portalAction(async (fd, t, lang) => {
  const f = z
    .object({
      name: z.string().trim().min(1),
      phone: z.string().trim().min(1),
      email: zStrOpt,
      address: z.string().trim().min(1),
      district: zStrOpt,
      area: zStrOpt,
      password: z.string(),
      confirm: z.string(),
    })
    .parse(fields(fd));
  if (f.password !== f.confirm) return { error: t.pwMismatch };
  const acc = await signUp(f);
  if (lang === "bn") await prisma.portalAccount.update({ where: { id: acc.id }, data: { locale: "BN" } });
  return { ok: true, message: t.signUpDone };
});

export async function portalLogoutAction() {
  await endPortalSession();
  redirect("/portal/login");
}

export const portalResetAction = portalAction(async (fd, t) => {
  const f = z.object({ token: z.string().min(1), password: z.string(), confirm: z.string() }).parse(fields(fd));
  if (f.password !== f.confirm) return { error: t.pwMismatch };
  const accountId = await resetPassword(f.token, f.password);
  await startPortalSession(accountId);
  redirect("/portal");
});

const lineSchema = z.object({
  _i: z.string(),
  productName: z.string().trim().min(1),
  color: zStrOpt,
  size: zStrOpt,
  model: zStrOpt,
  quantity: zIntPos,
  notes: zStrOpt,
  links: zStrOpt,
});

export const portalRequestAction = portalAction(async (fd) => {
  const acc = await requirePortalAccount();
  const h = z.object({ shippingMethod: z.enum(["AIR", "SEA"]), targetBudgetBdt: zDecOpt, customerNotes: zStrOpt }).parse(fields(fd));
  const lines = rows(fd, "lines").map((r) => lineSchema.parse(r));
  if (!lines.length) throw new UserError("Add at least one product");
  const { order } = await createPortalRequest(acc.customer.id, {
    ...h,
    lines: lines.map((l) => ({ productName: l.productName, color: l.color, size: l.size, model: l.model, quantity: l.quantity, notes: l.notes, links: splitLinks(l.links) })),
  });
  for (const [i, l] of lines.entries()) {
    const imgs = files(fd, `lines.${l._i}.images`);
    if (imgs.length) await saveCustomerFiles(imgs, acc.id, { orderLineId: order.lines[i].id });
  }
  revalidatePath("/portal");
  redirect(`/portal/requests/${order.id}`);
});

export const portalShippingAction = portalAction(async (fd) => {
  const acc = await requirePortalAccount();
  const h = z.object({ shippingMethod: z.enum(["AIR", "SEA"]), qaRequested: zBool, declaredWeightKg: zDecOpt, declaredCbm: zDecOpt, customerNotes: zStrOpt }).parse(fields(fd));
  const items = rows(fd, "p").map((r) => z.object({ _i: z.string(), productName: z.string().trim().min(1), description: zStrOpt, quantity: zIntMin0, courierName: zStrOpt, trackingNo: zStrOpt }).parse(r));
  const s = await createPortalShippingOrder(acc.customer.id, { ...h, items });
  const photos = files(fd, "photos");
  if (photos.length) await saveCustomerFiles(photos, acc.id, { shippingOrderId: s.id });
  await saveItemFiles(fd, items, s.id, { accountId: acc.id });
  revalidatePath("/portal");
  redirect(`/portal/shipping/${s.id}`);
});

export const portalTrackingAction = portalAction(async (fd, t) => {
  const acc = await requirePortalAccount();
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  const items = rows(fd, "t").map((r) => z.object({ itemId: z.string(), courierName: zStrOpt, trackingNo: zStrOpt }).parse(r));
  await updatePortalShippingTracking(acc.customer.id, id, items);
  revalidatePath(`/portal/shipping/${id}`);
  return { ok: true, message: t.trackingSaved };
});

/** Add photos / files to the customer's own request or shipping order. */
export const portalUploadAction = portalAction(async (fd, t) => {
  const acc = await requirePortalAccount();
  const { kind, id } = z.object({ kind: z.enum(["order", "shipping"]), id: z.string().min(1) }).parse(fields(fd));
  const owned =
    kind === "order"
      ? await prisma.order.count({ where: { id, customerId: acc.customer.id } })
      : await prisma.shippingOrder.count({ where: { id, customerId: acc.customer.id, status: { notIn: ["DELIVERED", "CANCELLED"] } } });
  if (!owned) throw new UserError("Not found");
  const list = files(fd, "photos");
  if (!list.length) return { ok: true };
  await saveCustomerFiles(list, acc.id, kind === "order" ? { orderId: id } : { shippingOrderId: id });
  revalidatePath(kind === "order" ? `/portal/requests/${id}` : `/portal/shipping/${id}`);
  return { ok: true, message: t.uploaded };
});

export const portalQuoteAction = portalAction(async (fd, t) => {
  const acc = await requirePortalAccount();
  const f = z.object({ estimateId: z.string().min(1), orderId: z.string().min(1), decision: z.enum(["APPROVE", "DECLINE"]), reason: zStrOpt }).parse(fields(fd));
  await decidePortalQuotation(acc.customer.id, f.estimateId, f.decision, f.reason);
  revalidatePath(`/portal/requests/${f.orderId}`);
  return { ok: true, message: f.decision === "APPROVE" ? t.quoteApproved : t.quoteDeclined };
});

const TARGET = z.object({ kind: z.enum(["order", "shipping", "sample"]), id: z.string().min(1) });
const revalidateTarget = (kind: string, id: string) => revalidatePath(kind === "order" ? `/portal/requests/${id}` : kind === "shipping" ? `/portal/shipping/${id}` : `/portal/samples/${id}`);

/** "I have paid": the customer reports a payment for CS to verify. */
export const portalPaymentAction = portalAction(async (fd, t) => {
  const acc = await requirePortalAccount();
  const target = TARGET.parse(fields(fd));
  const f = z
    .object({
      amountBdt: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Amount must be greater than zero"),
      method: z.enum(["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "CARD", "OTHER"]),
      reference: z.string(),
      paidAt: zYmd,
      note: zStrOpt,
    })
    .parse(fields(fd));
  const s = await submitPayment({ accountId: acc.id, customerId: acc.customer.id }, target, { ...f, paidAt: dayFromYmd(f.paidAt) });
  const shots = files(fd, "photos");
  if (shots.length) await saveAttachments(shots, "OTHER", { accountId: acc.id }, { paymentSubmissionId: s.id });
  revalidateTarget(target.kind, target.id);
  return { ok: true, message: t.paymentSent };
});

/** "I received it" with an optional note / problem and photos. */
export const portalReceiptAction = portalAction(async (fd, t) => {
  const acc = await requirePortalAccount();
  const target = TARGET.parse(fields(fd));
  const f = z.object({ note: zStrOpt, problem: zBool }).parse(fields(fd));
  await confirmReceipt(acc.customer.id, target.kind, target.id, f);
  const photos = files(fd, "photos");
  if (photos.length) {
    const owner = target.kind === "order" ? { orderId: target.id } : target.kind === "shipping" ? { shippingOrderId: target.id } : { sampleId: target.id };
    await saveAttachments(photos, "PACKAGE_PHOTO", { accountId: acc.id }, owner);
  }
  revalidateTarget(target.kind, target.id);
  return { ok: true, message: f.problem ? t.receiptProblemThanks : t.receiptThanks };
});
