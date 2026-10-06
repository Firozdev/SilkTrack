import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { CUSTOMER_FIELDS } from "@/server/customers";
import { ShippingOrderForm } from "./shipping-order-form";

export default async function NewShippingOrderPage({ searchParams }: PageProps<"/shipping-orders/new">) {
  await requirePagePermission("request:edit");
  const { customer: customerId } = await searchParams;
  const customer = typeof customerId === "string" ? await prisma.customer.findUnique({ where: { id: customerId }, select: CUSTOMER_FIELDS }) : null;
  return (
    <>
      <PageHeader title="New shipping order" subtitle="Shipping only: the customer has already bought the goods and the supplier sends them to our China warehouse." />
      <ShippingOrderForm customer={customer ?? undefined} />
    </>
  );
}
