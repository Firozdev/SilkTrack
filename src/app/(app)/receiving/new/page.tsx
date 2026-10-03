import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CartonRows } from "@/components/carton-rows";
import { Card, Field, PageHeader, inputCls } from "@/components/ui";
import { docNo, fmtCbm, fmtKg } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";
import { acceptingShipments } from "@/server/shipments";
import { estimatedPackaging } from "@/server/receiving";
import { receiveAction } from "../actions";

const CONDITIONS = [
  ["OK", "OK"],
  ["DAMAGED", "Damaged"],
  ["WRONG_ITEM", "Wrong item"],
  ["SHORT", "Short"],
] as const;

export default async function ReceivePage({ searchParams }: PageProps<"/receiving/new">) {
  await requirePagePermission("receiving:edit");
  const { so: soId } = await searchParams;
  if (typeof soId !== "string") notFound();
  const so = await prisma.supplierOrder.findUnique({
    where: { id: soId },
    include: {
      supplier: true,
      lines: {
        include: {
          receivingLines: { where: { receiving: { status: { not: "REPACKED" } } }, select: { quantityReceived: true } },
          orderLine: { select: { productName: true, color: true, size: true, model: true, order: { select: { number: true, shippingMethod: true, customer: { select: { code: true, name: true } } } } } },
        },
      },
    },
  });
  if (!so) notFound();
  const method = so.lines[0]?.orderLine.order.shippingMethod ?? "AIR";
  const toReceive = so.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity - l.receivingLines.reduce((a, r) => a + r.quantityReceived, 0) }));
  const [shipments, est] = await Promise.all([acceptingShipments(), estimatedPackaging(toReceive)]);
  const mark = [...new Set(so.lines.map((l) => l.orderLine.order.customer.code))].join("/");

  return (
    <>
      <PageHeader title={`Receive ${docNo("purchase", so.number)}`} subtitle={`${so.supplier.name} · ${so.courierName ?? ""} ${so.trackingNo ?? ""}`} />
      <ActionForm action={receiveAction} submitLabel="Save receiving" className="max-w-4xl">
        <input type="hidden" name="supplierOrderId" value={so.id} />
        <Card title="Items received">
          <div className="space-y-3">
            {so.lines.map((l, i) => {
              const received = l.receivingLines.reduce((a, r) => a + r.quantityReceived, 0);
              const left = l.quantity - received;
              return (
                <div key={l.id} className="grid items-end gap-2 border-b border-gray-50 pb-3 sm:grid-cols-6">
                  <input type="hidden" name={`l.${i}.purchaseLineId`} value={l.id} />
                  <div className="text-sm sm:col-span-3">
                    <b>{l.orderLine.productName}</b> <span className="text-gray-500">{[l.orderLine.color, l.orderLine.size, l.orderLine.model].filter(Boolean).join(" · ")}</span>
                    <div className="text-xs text-gray-500">
                      {docNo("order", l.orderLine.order.number)} · {l.orderLine.order.customer.code} · ordered {l.quantity}, received so far {received}
                    </div>
                  </div>
                  <Field label="Qty received">
                    <input name={`l.${i}.quantityReceived`} type="number" min={0} max={left} defaultValue={left} className={inputCls} />
                  </Field>
                  <Field label="Condition" className="sm:col-span-2">
                    <select name={`l.${i}.condition`} className={inputCls}>
                      {CONDITIONS.map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Package">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Overall condition">
              <select name="condition" className={inputCls}>
                {CONDITIONS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Carton label / mark">
              <input name="cartonMark" defaultValue={mark} className={inputCls} />
            </Field>
            <Field label="Net weight (kg)">
              <input name="netWeightKg" inputMode="decimal" className={inputCls} />
            </Field>
            <Field label="Gross weight (kg) *">
              <input name="grossWeightKg" inputMode="decimal" required defaultValue={est && est.grossWeightKg.gt(0) ? est.grossWeightKg.toString() : ""} className={inputCls} />
            </Field>
          </div>
          <div className="mt-4">
            {est && (
              <p className="mb-2 rounded bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Prefilled from quotation {est.estimates.map((n) => docNo("estimate", n)).join(", ")}: {fmtKg(est.grossWeightKg)}, {fmtCbm(est.cbm)} in {est.cartons.length} carton(s). Measure the
                parcel and correct the numbers if they differ.
              </p>
            )}
            <CartonRows initial={est?.cartons.map((c) => ({ l: c.lengthCm, w: c.widthCm, h: c.heightCm, kg: c.grossWeightKg }))} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Photos (product and package)">
              <input type="file" name="photos" accept="image/*" capture="environment" multiple className="text-sm" />
            </Field>
            <Field label="Notes">
              <input name="notes" className={inputCls} />
            </Field>
          </div>
        </Card>
        <Card title="Shipment">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ship by">
              <select name="shippingMethod" defaultValue={method} className={inputCls}>
                <option value="AIR">Air</option>
                <option value="SEA">Sea</option>
              </select>
            </Field>
            <Field label="Assign to shipment" hint="Suggested: the open shipment for this method; after cut-off, next week's.">
              <select name="shipmentId" defaultValue="auto" className={inputCls}>
                <option value="auto">Suggested (open {method.toLowerCase()} shipment)</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} ({s.status.toLowerCase()})
                  </option>
                ))}
                <option value="none">Don&apos;t assign yet</option>
              </select>
            </Field>
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
