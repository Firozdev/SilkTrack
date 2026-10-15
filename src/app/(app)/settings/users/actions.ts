"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formAction } from "@/lib/action";
import { fields, zBool, zStrOpt } from "@/lib/forms";
import { requirePermission } from "@/lib/session";
import { createStaff, resetStaffPassword, setStaffActive, updateStaff } from "@/server/users";

const done = (message: string) => {
  revalidatePath("/settings/users");
  return { ok: true, message };
};

export const createStaffAction = formAction(async (fd) => {
  const user = await requirePermission("user:manage");
  const f = z.object({ name: z.string(), email: z.string(), role: z.string(), password: zStrOpt, canSetSellingPrice: zBool }).parse(fields(fd));
  const { user: u, password } = await createStaff(user, f);
  return done(`${u.name} added. Login: ${u.email} · password: ${password} – give it to them and ask them to change it. It isn't shown again.`);
});

export const updateStaffAction = formAction(async (fd) => {
  const user = await requirePermission("user:manage");
  const f = z.object({ id: z.string().min(1), name: z.string(), email: z.string(), role: z.string(), canSetSellingPrice: zBool, timezone: z.string(), locale: z.string() }).parse(fields(fd));
  await updateStaff(user, f.id, f);
  return done("Saved.");
});

export const staffActiveAction = formAction(async (fd) => {
  const user = await requirePermission("user:manage");
  const { id, active } = z.object({ id: z.string().min(1), active: z.enum(["yes", "no"]) }).parse(fields(fd));
  await setStaffActive(user, id, active === "yes");
  return done(active === "yes" ? "Enabled – they can log in again." : "Disabled – logged out and can't log in.");
});

export const resetStaffPasswordAction = formAction(async (fd) => {
  const user = await requirePermission("user:manage");
  const { id, password } = z.object({ id: z.string().min(1), password: zStrOpt }).parse(fields(fd));
  const p = await resetStaffPassword(user, id, password);
  return done(`New password: ${p} – give it to them. It isn't shown again.`);
});
