import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { portalRequestEditable } from "@/lib/editability";
import { docNo } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalOrder } from "@/server/portal";
import { ownerOf } from "@/server/portal-access";
import { portalRequestUpdateAction } from "../../../../actions";
import { getDict } from "../../../../lang";
import { PortalRequestForm } from "../../new/request-form";

export default async function PortalEditRequestPage({ params }: PageProps<"/portal/requests/[id]/edit">) {
  const acc = await requirePortalAccount();
  const { t } = await getDict();
  const { id } = await params;
  const cid = await ownerOf(acc, "order", id);
  const o = cid ? await portalOrder(cid, id) : null;
  if (!cid || !o) notFound();
  if (!portalRequestEditable({ requestStatus: o.requestStatus, estimateCount: o._count.estimates })) redirect(`/portal/requests/${id}`);
  return (
    <>
      <Link href={`/portal/requests/${id}`} className="text-sm text-blue-700 hover:underline">
        ← {t.back}
      </Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">
        {t.editRequest} {docNo("order", o.number)}
      </h1>
      <PortalRequestForm
        t={t}
        action={portalRequestUpdateAction}
        submitLabel={t.saveChanges}
        initial={{
          id: o.id,
          shippingMethod: o.shippingMethod,
          targetBudgetBdt: o.targetBudgetBdt?.toString() ?? "",
          customerNotes: o.customerNotes ?? "",
          lines: o.lines
            .filter((l) => l.status !== "CANCELLED")
            .map((l) => ({
              id: l.id,
              productName: l.productName,
              color: l.color ?? "",
              size: [l.size, l.model].filter(Boolean).join(" / "),
              quantity: l.quantity,
              notes: l.notes ?? "",
              links: l.links.map((x) => x.url).join("\n"),
              files: l.attachments.length,
            })),
        }}
      />
    </>
  );
}
