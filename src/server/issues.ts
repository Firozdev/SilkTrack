import "server-only";
import type { IssueStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logChanges } from "@/lib/audit";
import { UserError } from "@/lib/action";
import { docNo } from "@/lib/format";
import { notify } from "./notify";
import type { Actor } from "./actor";

/** Any team member can work an issue; every change is logged. */
export async function updateIssue(actor: Actor, id: string, input: { status: IssueStatus; resolution?: string }) {
  const issue = await prisma.issue.findUnique({ where: { id } });
  if (!issue) throw new UserError("Issue not found");
  if ((input.status === "RESOLVED" || input.status === "CLOSED") && !input.resolution && !issue.resolution) {
    throw new UserError("Describe how it was resolved");
  }
  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id },
      data: {
        status: input.status,
        resolution: input.resolution ?? issue.resolution,
        resolvedAt: input.status === "RESOLVED" || input.status === "CLOSED" ? (issue.resolvedAt ?? new Date()) : null,
      },
    });
    await logChanges(tx, {
      entityType: "Issue",
      entityId: id,
      userId: actor.id,
      action: "UPDATE",
      changes: issue.status === input.status ? [] : [{ field: "status", oldValue: issue.status, newValue: input.status }],
    });
  });
  const closing = input.status === "RESOLVED" || input.status === "CLOSED";
  if (closing && (issue.status === "OPEN" || issue.status === "IN_PROGRESS")) {
    const order = issue.orderId ? await prisma.order.findUnique({ where: { id: issue.orderId }, select: { id: true, number: true, customerId: true } }) : null;
    await notify(
      "ISSUE_RESOLVED",
      { issue, order: order ?? undefined, customerId: order?.customerId, ref: order ? docNo("order", order.number) : docNo("issue", issue.number), staffLink: `/issues?id=${issue.id}` },
      { issue: docNo("issue", issue.number), resolution: input.resolution ?? issue.resolution },
      { userId: actor.id },
    );
  }
}
