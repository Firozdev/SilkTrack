import type { OrderStatus } from "@/generated/prisma/enums";

/**
 * Bangladesh stages of a Buy for Me order, after "In shipment" (and the
 * automatic "In transit"). Admin moves an order forward one step at a time.
 */
export const BD_STAGES = ["ARRIVED_BD", "CUSTOMS_CLEARED", "INVOICE_SHARED", "PAYMENT_COLLECTED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"] as const satisfies readonly OrderStatus[];
export type BdStage = (typeof BD_STAGES)[number];

/** Staff names for the steps (customers see the portal's own labels). */
export const STAGE_LABEL: Record<BdStage | "IN_SHIPMENT" | "IN_TRANSIT", string> = {
  IN_SHIPMENT: "In shipment",
  IN_TRANSIT: "In transit",
  ARRIVED_BD: "Bangladesh received",
  CUSTOMS_CLEARED: "Customs clearance",
  INVOICE_SHARED: "Final invoice prepared & shared with customer",
  PAYMENT_COLLECTED: "Customer payment collected",
  READY_FOR_DELIVERY: "Ready for home delivery",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
};

export const isBdStage = (s: string): s is BdStage => (BD_STAGES as readonly string[]).includes(s);

/** Where "Move to next" goes from here, or null when it can't move forward. */
export function nextStage(status: OrderStatus): BdStage | null {
  if (status === "IN_SHIPMENT" || status === "IN_TRANSIT") return "ARRIVED_BD";
  if (!isBdStage(status)) return null;
  return BD_STAGES[BD_STAGES.indexOf(status) + 1] ?? null;
}

/** One step back (Bangladesh received goes back to In transit). */
export function previousStage(status: OrderStatus): OrderStatus | null {
  if (!isBdStage(status)) return null;
  const i = BD_STAGES.indexOf(status);
  return i === 0 ? "IN_TRANSIT" : BD_STAGES[i - 1];
}

/** "Ready for home delivery" (and later) only once the customer's payment is collected. */
export function paymentGateBlocks(from: OrderStatus, to: BdStage) {
  const gate = BD_STAGES.indexOf("READY_FOR_DELIVERY");
  const reached = isBdStage(from) ? BD_STAGES.indexOf(from) : -1;
  return BD_STAGES.indexOf(to) >= gate && reached < BD_STAGES.indexOf("PAYMENT_COLLECTED");
}

/** Money steps are Admin's; the warehouse steps are also BD Warehouse's. */
export const MONEY_STAGES: readonly BdStage[] = ["INVOICE_SHARED", "PAYMENT_COLLECTED"];
export const stagePermission = (to: BdStage) => (MONEY_STAGES.includes(to) ? "invoice:edit" : "bdReceiving:edit") as "invoice:edit" | "bdReceiving:edit";
