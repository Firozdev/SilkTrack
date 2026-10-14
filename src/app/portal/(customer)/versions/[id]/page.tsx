import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, btnPrimaryCls } from "@/components/ui";
import { docNo } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { prisma } from "@/lib/prisma";
import { getVersion } from "@/server/custom-invoices";
import { portalUpdateVersionAction } from "../../../actions";
import { fill } from "../../../i18n";
import { getDict } from "../../../lang";
import { VersionEditor } from "../version-editor";

/** Edit / download one of this login's own invoice versions. */
export default async function VersionPage({ params, searchParams }: PageProps<"/portal/versions/[id]">) {
  const acc = await requirePortalAccount();
  const { t } = await getDict();
  const { id } = await params;
  const v = await getVersion(acc, id);
  if (!v) notFound();
  const so = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: v.shippingOrderId }, select: { number: true } });
  const saved = (await searchParams).saved === "1";
  return (
    <>
      <Link href={`/portal/shipping/${v.shippingOrderId}`} className="text-sm text-blue-700 hover:underline">
        ← {t.backToOrder}
      </Link>
      <div className="mb-1 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{v.label}</h1>
        <a href={`/portal/versions/${v.id}/pdf`} className={btnPrimaryCls}>
          ⬇ {t.downloadVersion}
        </a>
      </div>
      <p className="mb-4 text-sm text-gray-500">{fill(t.versionFrom, { ref: `INV-${docNo("shippingOrder", so.number)}` })}</p>
      {saved && (
        <div className="mb-4">
          <Alert tone="ok">{t.versionSaved}</Alert>
        </div>
      )}
      <VersionEditor key={v.updatedAt.toISOString()} t={t} initial={v.data} action={portalUpdateVersionAction} hidden={{ id: v.id }} logoUrl={v.logoKey ? `/portal/versions/${v.id}/logo?v=${encodeURIComponent(v.logoKey)}` : null} submitLabel={t.saveVersion} />
    </>
  );
}
