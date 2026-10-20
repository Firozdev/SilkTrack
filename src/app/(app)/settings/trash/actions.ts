"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UserError, formAction } from "@/lib/action";
import { fields } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { TRASHABLE, deleteForever, isTrashable, moveToTrash, restoreFromTrash } from "@/server/trash";

/** Only paths inside the app (no other sites). */
function safeBack(back: string | undefined): string | null {
  return back && back.startsWith("/") && !back.startsWith("//") && !back.startsWith("/\\") ? back : null;
}

export const moveToTrashAction = formAction(async (fd) => {
  const user = await requirePermission("record:delete");
  const f = z.object({ type: z.string(), id: z.string().min(1), back: z.string().optional() }).parse(fields(fd));
  if (!isTrashable(f.type)) throw new UserError("This kind of record can't be deleted here.");
  await moveToTrash(user, f.type, f.id);
  revalidatePath("/", "layout");
  redirect(safeBack(f.back) ?? TRASHABLE[f.type].back);
});

export const restoreAction = formAction(async (fd) => {
  const user = await requirePermission("record:delete");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  const r = await restoreFromTrash(user, id);
  revalidatePath("/", "layout");
  // Open the restored record; records without a page of their own (payments, comments…) were put back where they were.
  if (r.href) redirect(r.href);
  redirect(`/settings/trash?done=restored&type=${r.type}`);
});

export const deleteForeverAction = formAction(async (fd) => {
  const user = await requirePermission("record:delete");
  const { id } = z.object({ id: z.string().min(1) }).parse(fields(fd));
  await deleteForever(user, [id]);
  revalidatePath("/settings/trash");
  redirect("/settings/trash?done=deleted");
});

export const emptyTrashAction = formAction(async () => {
  const user = await requirePermission("record:delete");
  const n = await deleteForever(user);
  revalidatePath("/settings/trash");
  return { ok: true, message: `${n} item${n === 1 ? "" : "s"} deleted forever.` };
});
