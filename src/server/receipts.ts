import "server-only";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action";
import { docNo } from "@/lib/format";
import { setLineStatus } from "./status";
import { confirmShippingReceipt, notifyReceipt, receiptData } from "./shipping-orders";

export type ReceiptInput = { note?: string; problem: boolean };

/**
 * The customer confirms in the portal that they received their goods, with an
 * optional note / problem. Out for delivery → delivered; already delivered →
 * the note is saved (later notes are appended).
 */
export async function confirmReceipt(customerId: string, kind: "order" | "shipping" | "sample", id: string, input: ReceiptInput) {
  if (input.problem && !input.note?.trim()) throw new UserError("Tell us what is wrong");
  if (kind === "shipping") return confirmShippingReceipt(customerId, id, input);

  if (kind === "sample") {
    const s = await prisma.sample.findFirst({ where: { id, customerId } });
    if (!s) throw new UserError("Not found");
    if (s.status !== "DELIVERED") throw new UserError("You can confirm once the sample is delivered");
    const data = receiptData(s, input);
    await prisma.$transaction([
      prisma.sample.update({ where: { id }, data: { ...data, customerFeedback: s.customerFeedback ?? input.note?.trim() ?? null } }),
      prisma.sampleEvent.create({ data: { sampleId: id, message: `Customer confirmed receipt${input.problem ? " – PROBLEM reported" : ""}${input.note ? `: ${input.note}` : ""}` } }),
    ]);
    return notifyReceipt(docNo("sample", s.number), input, s.orderId ?? undefined);
  }

  const o = await prisma.order.findFirst({ where: { id, customerId }, include: { lines: { select: { id: true, status: true } } } });
  if (!o) throw new UserError("Not found");
  if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(o.status)) throw new UserError("You can confirm once the order is out for delivery");
  const data = receiptData(o, input);
  const msg = `Customer confirmed receipt in the portal${input.problem ? " – PROBLEM reported" : ""}${input.note ? `: ${input.note}` : ""}`;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data });
    const open = o.lines.filter((l) => l.status === "OUT_FOR_DELIVERY").map((l) => l.id);
    await setLineStatus(tx, open, "DELIVERED", { actorId: null, message: msg, leg: "BD_TO_CUSTOMER", onlyForward: true });
    await tx.delivery.updateMany({ where: { orderId: id, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } }, data: { status: "DELIVERED", deliveredAt: new Date(), receiverName: "Customer (portal)" } });
  });
  await notifyReceipt(docNo("order", o.number), input, id);
}
