import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import type { Trashable } from "@/server/trash";

/** Admin only: opens the delete confirmation, which lists what goes with the record to Trash. */
export function DeleteRecordLink({ role, type, id, small, back }: { role: Role; type: Trashable; id: string; small?: boolean; back?: string }) {
  if (!can(role, "record:delete")) return null;
  const href = `/settings/trash/delete?type=${type}&id=${encodeURIComponent(id)}${back ? `&back=${encodeURIComponent(back)}` : ""}`;
  return (
    <Link
      href={href}
      className={
        small
          ? "text-xs font-medium text-red-600 hover:underline"
          : "inline-flex items-center justify-center gap-1 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      }
    >
      🗑 Delete
    </Link>
  );
}
