import type { Decimal } from "./money";

/**
 * Payment steps for an order's tracking timeline: when the customer sent each
 * payment, and when it was confirmed (Admin or CS approving it, or recording it
 * at the counter). Refunds and rejected reports are left out.
 */
export type PaymentStep = {
  id: string;
  step: "SENT" | "CONFIRMED";
  at: Date;
  /** The customer's "date paid" is a calendar day, not a time. */
  dayOnly: boolean;
  /** ADVANCE / BALANCE…; null while a report waits (approval decides it). */
  type: string | null;
  amountBdt: Decimal;
  method: string;
  /** Reported but not confirmed yet. */
  waiting: boolean;
  /** Who confirmed it – only on staff pages (the portal query never loads it). */
  confirmedBy: string | null;
};

type ConfirmedPayment = { id: string; type: string; amountBdt: Decimal; method: string; paidAt: Date; createdAt: Date; receivedBy?: { name: string } | null };
type Report = { id: string; amountBdt: Decimal; method: string; paidAt: Date; status: string };

/** Day values are stored as midnight UTC. */
const isDay = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

export function paymentSteps(payments: ConfirmedPayment[], reports: Report[] = []): PaymentStep[] {
  const steps: PaymentStep[] = [];
  for (const p of payments) {
    if (p.type === "REFUND") continue;
    const base = { type: p.type, amountBdt: p.amountBdt, method: p.method, waiting: false };
    steps.push({ ...base, id: `${p.id}-sent`, step: "SENT", at: p.paidAt, dayOnly: isDay(p.paidAt), confirmedBy: null });
    // A payment row is created at the moment it is confirmed.
    steps.push({ ...base, id: `${p.id}-confirmed`, step: "CONFIRMED", at: p.createdAt, dayOnly: false, confirmedBy: p.receivedBy?.name ?? null });
  }
  for (const r of reports) {
    if (r.status !== "PENDING") continue;
    steps.push({ id: `${r.id}-sent`, step: "SENT", at: r.paidAt, dayOnly: isDay(r.paidAt), type: null, amountBdt: r.amountBdt, method: r.method, waiting: true, confirmedBy: null });
  }
  return steps.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.step === b.step ? 0 : a.step === "SENT" ? -1 : 1));
}
