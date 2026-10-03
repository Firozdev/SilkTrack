import { ActionForm } from "@/components/action-form";
import { CartonRows } from "@/components/carton-rows";
import { A, Alert, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { docNo, fmtCbm, fmtKg } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { sum } from "@/lib/money";
import { repackAction } from "../actions";

export default async function RepackPage({ searchParams }: PageProps<"/receiving/repack">) {
  await requirePagePermission("receiving:edit");
  const sp = await searchParams;
  const ids = [sp.ids ?? []].flat();
  const parcels = await prisma.receiving.findMany({ where: { id: { in: ids }, status: { not: "REPACKED" } } });
  if (parcels.length < 2) {
    return (
      <>
        <PageHeader title="Repack parcels" />
        <Alert tone="warn">
          Select at least two parcels on the <A href="/receiving">receiving page</A>.
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Repack parcels" subtitle={`Merging ${parcels.map((p) => docNo("receiving", p.number)).join(", ")} – current total ${fmtKg(sum(parcels.map((p) => p.grossWeightKg)))}, ${fmtCbm(sum(parcels.map((p) => p.cbm)))}`} />
      <ActionForm action={repackAction} submitLabel="Repack" className="max-w-3xl">
        {parcels.map((p) => (
          <input key={p.id} type="hidden" name="ids" value={p.id} />
        ))}
        <Card title="New carton(s)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Carton mark">
              <input name="cartonMark" className={inputCls} />
            </Field>
            <Field label="Net weight (kg)">
              <input name="netWeightKg" inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Gross weight (kg) *">
              <input name="grossWeightKg" inputMode="decimal" required className={inputCls} />
            </Field>
          </div>
          <div className="mt-4">
            <CartonRows />
          </div>
          <Field label="Shipment" className="mt-4 max-w-xs">
            <select name="shipmentId" defaultValue="auto" className={inputCls}>
              <option value="auto">Suggested open shipment</option>
              <option value="none">Don&apos;t assign yet</option>
            </select>
          </Field>
        </Card>
      </ActionForm>
    </>
  );
}
