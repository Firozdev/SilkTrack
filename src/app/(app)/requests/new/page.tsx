import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_FIELDS } from "@/server/customers";
import { RequestForm } from "./request-form";

export default async function NewRequestPage({ searchParams }: PageProps<"/requests/new">) {
  await requirePagePermission("request:edit");
  const { customer: customerId } = await searchParams;
  const [threshold, customer] = await Promise.all([
    getSetting("bulk_threshold"),
    typeof customerId === "string" ? prisma.customer.findUnique({ where: { id: customerId }, select: CUSTOMER_FIELDS }) : null,
  ]);
  return (
    <>
      <PageHeader title="New product request" />
      <RequestForm bulkQty={threshold.quantity} customer={customer ?? undefined} />
    </>
  );
}
