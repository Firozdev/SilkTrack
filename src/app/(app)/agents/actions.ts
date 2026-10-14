"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zStrOpt } from "@/lib/forms";
import { whatsappLink } from "@/lib/notify";
import { origin } from "@/lib/origin";
import { requireUser } from "@/lib/session";
import { assignAgent, createAgent, reinviteAgent } from "@/server/agents";

async function inviteLinks(acc: { name: string; phone: string }, token: string) {
  const url = `${await origin()}/portal/invite?token=${token}`;
  const text = `Dear ${acc.name}, your SilkTrack agent login is ready. Set your password here (valid 7 days, one use): ${url} – then log in with your mobile number ${acc.phone} to order for your customers. SilkTrack`;
  return [
    { href: whatsappLink(acc.phone, text), label: "💬 Send by WhatsApp" },
    { href: url, label: url },
  ];
}

export const createAgentAction = formAction(async (fd) => {
  const user = await requireUser();
  const f = z.object({ name: z.string(), phone: z.string(), email: zStrOpt }).parse(fields(fd));
  const { token, account } = await createAgent(user, f);
  revalidatePath("/agents");
  return { ok: true, message: `Agent ${account.name} created. Send them the link – it works once and expires in 7 days.`, links: await inviteLinks(account, token) };
});

export const reinviteAgentAction = formAction(async (fd) => {
  const user = await requireUser();
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  const { token, account } = await reinviteAgent(user, id);
  return { ok: true, message: "New invitation created – the old link no longer works.", links: await inviteLinks(account, token) };
});

/** Assign a customer to an agent (or remove: empty agentId). */
export const assignAgentAction = formAction(async (fd) => {
  const user = await requireUser();
  const { customerId, agentId } = z.object({ customerId: z.string().min(1), agentId: zStrOpt }).parse(fields(fd));
  await assignAgent(user, customerId, agentId || null);
  revalidatePath("/agents");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: agentId ? "Customer assigned to the agent." : "Removed from the agent." };
});
