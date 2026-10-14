"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { markAllRead, markRead, setSound } from "@/server/notifications";

// Called from the bell (client) – each acts only on the signed-in user's own notifications.
export async function markReadAction(id: string) {
  const user = await requireUser();
  await markRead({ userId: user.id }, String(id));
}

export async function markAllReadAction() {
  const user = await requireUser();
  await markAllRead({ userId: user.id });
  revalidatePath("/notifications");
}

export async function setSoundAction(on: boolean) {
  const user = await requireUser();
  await setSound({ userId: user.id }, on === true);
}
