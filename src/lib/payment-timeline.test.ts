import { describe, expect, it } from "vitest";
import { D } from "./money";
import { paymentSteps } from "./payment-timeline";

describe("paymentSteps", () => {
  it("sent then confirmed per payment, waiting reports, no refunds or reviewed reports", () => {
    const p = (id: string, type: string, paidAt: string, createdAt: string) => ({ id, type, amountBdt: D("100"), method: "BKASH", paidAt: new Date(paidAt), createdAt: new Date(createdAt), receivedBy: { name: "Rina" } });
    const steps = paymentSteps(
      [p("a", "ADVANCE", "2026-10-01T00:00:00Z", "2026-10-02T05:30:00Z"), p("r", "REFUND", "2026-10-03T00:00:00Z", "2026-10-03T00:00:00Z"), p("c", "BALANCE", "2026-10-04T08:15:00Z", "2026-10-04T08:15:00Z")],
      [
        { id: "w", amountBdt: D("50"), method: "NAGAD", paidAt: new Date("2026-10-05T00:00:00Z"), status: "PENDING" },
        { id: "x", amountBdt: D("50"), method: "NAGAD", paidAt: new Date("2026-10-05T00:00:00Z"), status: "REJECTED" },
      ],
    );
    expect(steps.map((s) => s.id)).toEqual(["a-sent", "a-confirmed", "c-sent", "c-confirmed", "w-sent"]);
    expect(steps.map((s) => s.dayOnly)).toEqual([true, false, false, false, true]);
    expect(steps.find((s) => s.id === "a-confirmed")!.confirmedBy).toBe("Rina");
    expect(steps.find((s) => s.id === "w-sent")!.waiting).toBe(true);
  });
});
