import { redirect } from "next/navigation";
import { A, Alert, PageHeader } from "@/components/ui";
import { docNo } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";
import { quotationFormData } from "../form-data";
import { QuotationForm } from "../quotation-form";

export default async function NewQuotationPage({ searchParams }: PageProps<"/estimates/new">) {
  const user = await requirePagePermission("estimate:edit");
  const { order: orderId } = await searchParams;
  if (typeof orderId !== "string") redirect("/estimates");
  const d = await quotationFormData(orderId, user);
  if (d.order.requestStatus !== "SENT_TO_CHINA") {
    return (
      <>
        <PageHeader title="China quotation" />
        <Alert tone="warn">
          <A href={`/requests/${d.order.id}`}>{docNo("order", d.order.number)}</A> is not waiting for a quotation.
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={`${d.draft ? `Edit quotation v${d.draft.version}` : "New quotation"} · ${docNo("order", d.order.number)}`}
        subtitle={`${d.order.customer.code} · ${d.order.type === "BULK" ? "Bulk" : "Single"} · customer prefers ${d.order.shippingMethod.toLowerCase()}`}
      />
      <QuotationForm orderId={d.order.id} lines={d.lines} initial={d.initial} canSetSelling={d.canSetSelling} rate={d.rate} />
    </>
  );
}
