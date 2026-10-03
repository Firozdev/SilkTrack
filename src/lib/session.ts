import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCan, can, type Action } from "@/lib/permissions";

/**
 * The signed-in user, re-read from the database so that deactivation and
 * role changes take effect immediately (not only when the JWT expires).
 */
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, locale: true, timezone: true, active: true, canSetSellingPrice: true },
  });
  return user?.active ? user : null;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** For pages: redirect to /login when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions and route handlers: throws ForbiddenError if not allowed. */
export async function requirePermission(action: Action): Promise<CurrentUser> {
  const user = await requireUser();
  assertCan(user.role, action);
  return user;
}

/** For pages: show the "not allowed" page when the role lacks `action`. */
export async function requirePagePermission(action: Action): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, action)) redirect("/denied");
  return user;
}
