import "server-only";
import type { NotificationChannel } from "@/generated/prisma/client";
import { prisma } from "./prisma";

type Msg = { type: string; title: string; body: string; orderId?: string | null };

/** In-app notifications: see src/server/notify.ts. */

/**
 * Queue a customer message. No SMS/WhatsApp gateway yet (phase 2): the row
 * stays PENDING and Admin sends it by hand from the Notifications page.
 */
export async function queueCustomerMessage(
  customerId: string,
  channel: Exclude<NotificationChannel, "IN_APP">,
  msg: Msg,
) {
  await prisma.notification.create({ data: { ...msg, channel, customerId } });
}

/** wa.me link with the message pre-filled; phone in BD local or +880 format. */
export function whatsappLink(phone: string, text: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "88" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
