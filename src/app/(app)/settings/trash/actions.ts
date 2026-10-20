"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UserError, formAction } from "@/lib/action";
import { fields } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { TRASHABLE, deleteForever, isTrashable, moveManyToTrash, moveToTrash, restoreFromTrash, restoreManyFromTrash } from "@/server/trash";

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

const idsOf = (fd: FormData) => fd.getAll("id").filter((v): v is string => typeof v === "string" && v.length > 0);

/** Bulk delete from a list: every selected record goes to Trash on its own. */
export const moveManyToTrashAction = formAction(async (fd) => {
  const user = await requirePermission("record:delete");
  const f = z.object({ type: z.string(), back: z.string().optional() }).parse(fields(fd));
  if (!isTrashable(f.type)) throw new UserError("This kind of record can't be deleted here.");
  const r = await moveManyToTrash(user, f.type, idsOf(fd));
  revalidatePath("/", "layout");
  if (r.skipped.length && !r.moved) throw new UserError(r.skipped.map((x) => `${x.label}: ${x.reason}`).join(" · "));
  redirect(safeBack(f.back) ?? TRASHABLE[f.type].back);
});

/** Trash page: restore or delete forever the selected items. */
export const trashBulkAction = formAction(async (fd) => {
  const user = await requirePermission("record:delete");
  const ids = idsOf(fd);
  if (!ids.length) throw new UserError("Select at least one item.");
  if (fd.get("op") === "forever") {
    const n = await deleteForever(user, ids);
    revalidatePath("/settings/trash");
    return { ok: true, message: `${n} item${n === 1 ? "" : "s"} deleted forever.` };
  }
  const r = await restoreManyFromTrash(user, ids);
  revalidatePath("/", "layout");
  const failed = r.failed.map((x) => `${x.label}: ${x.reason}`).join(" · ");
  if (!r.restored) throw new UserError(failed);
  return { ok: true, message: `${r.restored} item${r.restored === 1 ? "" : "s"} restored.${failed ? ` Not restored – ${failed}` : ""}` };
});
