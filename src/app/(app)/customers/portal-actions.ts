"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields } from "@/lib/forms";
import { whatsappLink } from "@/lib/notify";
import { origin } from "@/lib/origin";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { approveAccount, createResetToken, inviteCustomer, rejectAccount, setAccountDisabled } from "@/server/portal-auth";

const idOf = (fd: FormData) => z.object({ id: z.string().min(1) }).parse(fields(fd)).id;

export const approveAction = formAction(async (fd) => {
  const user = await requireUser();
  const { customerId } = z.object({ customerId: z.string().optional() }).parse(fields(fd));
  await approveAccount(user, idOf(fd), customerId || undefined);
  revalidatePath("/customers", "layout");
  return { ok: true, message: "Approved – the customer can log in now." };
});

export const rejectAction = formAction(async (fd) => {
  const user = await requireUser();
  const reason = z.string().trim().min(1, "Give a reason").parse(fd.get("reason"));
  await rejectAccount(user, idOf(fd), reason);
  revalidatePath("/customers", "layout");
  return { ok: true, message: "Rejected." };
});

export const disableAction = formAction(async (fd) => {
  const user = await requireUser();
  const { disabled } = z.object({ disabled: z.enum(["yes", "no"]) }).parse(fields(fd));
  await setAccountDisabled(user, idOf(fd), disabled === "yes");
  revalidatePath("/customers", "layout");
  revalidatePath("/agents");
  return { ok: true, message: disabled === "yes" ? "Disabled and logged out." : "Enabled." };
});

export const resetLinkAction = formAction(async (fd) => {
  const user = await requireUser();
  const id = idOf(fd);
  const token = await createResetToken(user, id);
  const acc = await prisma.portalAccount.findUniqueOrThrow({ where: { id }, select: { phone: true, name: true } });
  const url = `${await origin()}/portal/reset?token=${token}`;
  const text = `Dear ${acc.name}, set a new password for your SilkTruck account here (valid 24 hours, one use): ${url}`;
  return {
    ok: true,
    message: "Reset link created. Send it to the customer only – anyone with it can set the password.",
    links: [
      { href: whatsappLink(acc.phone, text), label: "💬 Send by WhatsApp" },
      { href: url, label: url },
    ],
  };
});

export const inviteAction = formAction(async (fd) => {
  const user = await requireUser();
  const { customerId } = z.object({ customerId: z.string().min(1) }).parse(fields(fd));
  const inv = await inviteCustomer(user, customerId);
  const url = `${await origin()}/portal/invite?token=${inv.token}`;
  const text = `Dear ${inv.name}, you can now track your orders, shipments and bills online. Set your password here (valid 7 days, one use): ${url} – then log in with your mobile number ${inv.phone}. SilkTruck`;
  revalidatePath("/customers", "layout");
  return {
    ok: true,
    message: "Invitation created. Send it to the customer – the link works once and expires in 7 days.",
    links: [
      { href: whatsappLink(inv.phone, text), label: "💬 Send by WhatsApp" },
      { href: url, label: url },
    ],
  };
});
