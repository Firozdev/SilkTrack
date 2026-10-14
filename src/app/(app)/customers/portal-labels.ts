import type { PortalAccountStatus } from "@/generated/prisma/client";

export const PORTAL_LABEL: Record<PortalAccountStatus, string> = { ACTIVE: "Portal user", INVITED: "Invited", PENDING: "Pending approval", DISABLED: "Disabled", REJECTED: "Rejected" };
/** Badge colour key per status (see Badge in components/ui). */
export const PORTAL_BADGE: Record<PortalAccountStatus, string> = { ACTIVE: "COMPLETED", INVITED: "UPCOMING", PENDING: "PENDING", DISABLED: "CANCELLED", REJECTED: "REJECTED" };
