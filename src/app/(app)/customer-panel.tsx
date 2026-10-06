import { A, Alert } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { fmtBdt, humanize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { submissionNo } from "@/server/payment-submissions";

/**
 * What the customer did in the portal on this record: payments waiting for
 * verification and their "received" confirmation / note / problem.
 */
export async function CustomerPanel({ kind, id, tz }: { kind: "order" | "shipping" | "sample"; id: string; tz: string }) {
  const where = kind === "order" ? { orderId: id } : kind === "shipping" ? { shippingOrderId: id } : { sampleId: id };
  const select = { customerConfirmedAt: true, customerNote: true, customerReportedProblem: true } as const;
  const [pending, r] = await Promise.all([
    prisma.paymentSubmission.findMany({ where: { ...where, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    kind === "order"
      ? prisma.order.findUnique({ where: { id }, select })
      : kind === "shipping"
        ? prisma.shippingOrder.findUnique({ where: { id }, select })
        : prisma.sample.findUnique({ where: { id }, select }),
  ]);
  if (!pending.length && !r?.customerConfirmedAt) return null;
  return (
    <div className="mb-4 space-y-2">
      {pending.length > 0 && (
        <Alert tone="warn">
          💳 Customer reported {pending.length} payment(s) to verify:{" "}
          {pending.map((p) => `${submissionNo(p)} ${fmtBdt(p.amountBdt)} ${humanize(p.method)} ${p.reference}`).join("; ")} –{" "}
          <A href="/payments-to-verify">verify now</A>
        </Alert>
      )}
      {r?.customerConfirmedAt && (
        <Alert tone={r.customerReportedProblem ? "error" : "ok"}>
          {r.customerReportedProblem ? "⚠ Problem reported by customer" : "✓ Customer confirmed receipt"} on {fmtDateTime(r.customerConfirmedAt, tz)}
          {r.customerNote && <span className="mt-1 block whitespace-pre-line">“{r.customerNote}”</span>}
        </Alert>
      )}
    </div>
  );
}
