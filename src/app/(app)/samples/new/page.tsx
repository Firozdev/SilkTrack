import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { CUSTOMER_FIELDS } from "@/server/customers";
import { SampleForm } from "./sample-form";

export default async function NewSamplePage({ searchParams }: PageProps<"/samples/new">) {
  await requirePagePermission("request:edit");
  const { customer: customerId } = await searchParams;
  const customer = typeof customerId === "string" ? await prisma.customer.findUnique({ where: { id: customerId }, select: CUSTOMER_FIELDS }) : null;
  return (
    <>
      <PageHeader title="New sample" subtitle="A sample without a request. The China team invoices it, then it is bought, shipped and delivered like any sample." />
      <SampleForm customer={customer ?? undefined} />
    </>
  );
}
