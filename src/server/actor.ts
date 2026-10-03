import type { Role } from "@/generated/prisma/enums";

/** The user performing a service call. */
export type Actor = { id: string; role: Role; canSetSellingPrice?: boolean };
