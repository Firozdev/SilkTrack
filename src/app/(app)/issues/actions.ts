"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zStrOpt } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import { updateIssue } from "@/server/issues";

export const issueAction = formAction(async (fd) => {
  const user = await requireUser();
  const i = z.object({ id: z.string(), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]), resolution: zStrOpt }).parse(fields(fd));
  await updateIssue(user, i.id, i);
  revalidatePath("/issues");
  return { ok: true, message: "Saved." };
});
