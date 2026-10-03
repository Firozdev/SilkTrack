import type { Prisma } from "@/generated/prisma/client";
import { ActionForm } from "@/components/action-form";
import { A, Badge, Card, PageHeader, btnCls, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { docNo, humanize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { issueAction } from "./actions";

export default async function IssuesPage({ searchParams }: PageProps<"/issues">) {
  const user = await requireUser();
  const sp = await searchParams;
  const where: Prisma.IssueWhereInput = {};
  if (typeof sp.id === "string") where.id = sp.id;
  else if (sp.status === "all") {
    /* everything */
  } else where.status = { in: ["OPEN", "IN_PROGRESS"] };
  if (sp.source === "CHINA_RECEIVING" || sp.source === "BD_RECEIVING" || sp.source === "DELIVERY") where.source = sp.source;

  const issues = await prisma.issue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      order: { select: { id: true, number: true, customer: { select: { code: true } } } },
      orderLine: { select: { productName: true } },
      receiving: { select: { id: true, number: true } },
      reportedBy: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader title="Issues" subtitle="Damaged, wrong, short or missing items and weight mismatches, from China and Bangladesh." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={typeof sp.status === "string" ? sp.status : ""} className={`${inputCls} max-w-[10rem]`}>
          <option value="">Open</option>
          <option value="all">All</option>
        </select>
        <select name="source" defaultValue={typeof sp.source === "string" ? sp.source : ""} className={`${inputCls} max-w-[12rem]`}>
          <option value="">China + BD</option>
          <option value="CHINA_RECEIVING">China receiving</option>
          <option value="BD_RECEIVING">BD receiving</option>
          <option value="DELIVERY">Delivery</option>
        </select>
        <button className={btnCls}>Filter</button>
      </form>
      <div className="space-y-3">
        {issues.length === 0 && <p className="text-sm text-gray-400">No issues 🎉</p>}
        {issues.map((i) => (
          <Card key={i.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{docNo("issue", i.number)}</b> <Badge value={i.type} /> <Badge value={i.status} /> <span className="text-gray-500">{humanize(i.source)}</span>
                </div>
                <p className="mt-1">{i.description}</p>
                <div className="mt-1 text-xs text-gray-500">
                  {i.order && (
                    <>
                      <A href={`/requests/${i.order.id}`}>{docNo("order", i.order.number)}</A> ({i.order.customer.code}){" "}
                    </>
                  )}
                  {i.orderLine && <>· {i.orderLine.productName} </>}
                  {i.receiving && (
                    <>
                      · <A href={`/receiving/${i.receiving.id}`}>{docNo("receiving", i.receiving.number)}</A>{" "}
                    </>
                  )}
                  · reported by {i.reportedBy.name}, {fmtDateTime(i.createdAt, user.timezone)}
                  {i.assignedTo && <> · assigned to {i.assignedTo.name}</>}
                </div>
                {i.resolution && <p className="mt-1 text-green-800">Resolution: {i.resolution}</p>}
              </div>
              <ActionForm action={issueAction} submitLabel="Save" inline className="max-w-md">
                <input type="hidden" name="id" value={i.id} />
                <select name="status" defaultValue={i.status} className={`${inputCls} max-w-[9rem]`}>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <input name="resolution" defaultValue={i.resolution ?? ""} placeholder="Resolution" className={`${inputCls} max-w-[14rem]`} />
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
