"use server";

import { revalidatePath } from "next/cache";
import { formAction } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { markAllRead } from "@/server/notifications";

export const markAllFormAction = formAction(async () => {
  const user = await requireUser();
  await markAllRead({ userId: user.id });
  revalidatePath("/notifications");
  return { ok: true, message: "All marked as read." };
});
