import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { portalShippingEditable } from "@/lib/editability";
import { docNo } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalShippingOrder } from "@/server/portal";
import { ownerOf } from "@/server/portal-access";
import { portalShippingUpdateAction } from "../../../../actions";
import { getDict } from "../../../../lang";
import { PortalShippingForm } from "../../new/shipping-form";
import { rateCard } from "@/server/shipping-rates";

export default async function PortalEditShippingPage({ params }: PageProps<"/portal/shipping/[id]/edit">) {
  const acc = await requirePortalAccount();
  const [{ t }, rates] = await Promise.all([getDict(), rateCard()]);
  const { id } = await params;
  const cid = await ownerOf(acc, "shipping", id);
  const s = cid ? await portalShippingOrder(cid, id) : null;
  if (!cid || !s) notFound();
  if (!portalShippingEditable(s)) redirect(`/portal/shipping/${id}`);
  return (
    <>
      <Link href={`/portal/shipping/${id}`} className="text-sm text-blue-700 hover:underline">
        ← {t.back}
      </Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">
        {t.editShipping} {docNo("shippingOrder", s.number)}
      </h1>
      <PortalShippingForm
        t={t}
        rates={rates}
        action={portalShippingUpdateAction}
        submitLabel={t.saveChanges}
        initial={{
          id: s.id,
          shippingMethod: s.shippingMethod,
          qaRequested: s.qaRequested,
          declaredWeightKg: s.declaredWeightKg?.toString() ?? "",
          declaredCbm: s.declaredCbm?.toString() ?? "",
          customerNotes: s.customerNotes ?? "",
          items: s.items.map((i) => ({
            id: i.id,
            productName: i.productName,
            description: i.description ?? "",
            quantity: i.quantity,
            courierName: i.courierName ?? "",
            trackingNo: i.trackingNo ?? "",
            files: i.attachments.length,
          })),
        }}
      />
    </>
  );
}
