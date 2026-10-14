import Link from "next/link";
import { notFound } from "next/navigation";
import { docNo } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { prisma } from "@/lib/prisma";
import { prefillVersion } from "@/server/custom-invoices";
import { portalCreateVersionAction } from "../../../../../actions";
import { fill } from "../../../../../i18n";
import { getDict } from "../../../../../lang";
import { VersionEditor } from "../../../../versions/version-editor";

/** Start a new "my own version", pre-filled from our invoice. */
export default async function NewVersionPage({ params }: PageProps<"/portal/shipping/[id]/versions/new">) {
  const acc = await requirePortalAccount();
  const { t } = await getDict();
  const { id } = await params;
  const initial = await prefillVersion(acc, id).catch(() => null);
  if (!initial) notFound();
  const so = await prisma.shippingOrder.findUniqueOrThrow({ where: { id }, select: { number: true } });
  return (
    <>
      <Link href={`/portal/shipping/${id}`} className="text-sm text-blue-700 hover:underline">
        ← {t.backToOrder}
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-semibold">{t.createVersion}</h1>
      <p className="mb-4 text-sm text-gray-500">{fill(t.versionFrom, { ref: `INV-${docNo("shippingOrder", so.number)}` })}</p>
      <VersionEditor t={t} initial={initial} action={portalCreateVersionAction} hidden={{ shippingOrderId: id }} logoUrl={null} submitLabel={t.saveVersion} />
    </>
  );
}
