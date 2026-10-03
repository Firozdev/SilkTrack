import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Alert, Attachments, Badge, Card, Dl, PageHeader, Table, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg, fmtNum, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { acceptingShipments } from "@/server/shipments";
import { moveAction, photoAction } from "../actions";

export default async function ReceivingDetail({ params, searchParams }: PageProps<"/receiving/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { warn } = await searchParams;
  const r = await prisma.receiving.findUnique({
    where: { id },
    include: {
      receivedBy: { select: { name: true } },
      supplierOrder: { select: { id: true, number: true } },
      shipment: true,
      repackedInto: { select: { id: true, number: true } },
      repackedFrom: { select: { id: true, number: true } },
      cartons: true,
      attachments: { select: { id: true, fileName: true, mimeType: true } },
      issues: true,
      lines: { include: { orderLine: { select: { productName: true, color: true, size: true, model: true, order: { select: { id: true, number: true, customer: { select: { code: true, name: true } } } } } } } },
    },
  });
  if (!r) notFound();
  const canMove = can(user.role, "shipment:edit") && r.status !== "REPACKED" && (!r.shipment || ["UPCOMING", "OPEN"].includes(r.shipment.status));
  const options = canMove ? await acceptingShipments(r.shippingMethod) : [];

  return (
    <>
      <PageHeader
        title={docNo("receiving", r.number)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={r.status} /> <Badge value={r.condition} /> received {fmtDateTime(r.receivedAt, user.timezone)} by {r.receivedBy.name}
          </span>
        }
      />
      {typeof warn === "string" && <Alert tone="warn">⚠ {warn}</Alert>}
      {r.repackedInto && (
        <Alert tone="info">
          Repacked into <A href={`/receiving/${r.repackedInto.id}`}>{docNo("receiving", r.repackedInto.number)}</A>.
        </Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Contents">
            <Table head={["Order", "Customer", "Product", "Received / ordered", "Condition", "Freight share"]}>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td className={tdCls}>
                    <A href={`/requests/${l.orderLine.order.id}`}>{docNo("order", l.orderLine.order.number)}</A>
                  </td>
                  <td className={tdCls}>{l.orderLine.order.customer.code}</td>
                  <td className={tdCls}>
                    {l.orderLine.productName}
                    <div className="text-xs text-gray-400">{[l.orderLine.color, l.orderLine.size, l.orderLine.model].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={tdCls}>
                    {l.quantityReceived} / {l.quantityOrdered}
                  </td>
                  <td className={tdCls}>
                    <Badge value={l.condition} />
                  </td>
                  <td className={tdCls}>{fmtBdt(l.freightShareBdt)}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Cartons">
            <Table head={["#", "L × W × H (cm)", "CBM", "Weight"]}>
              {r.cartons.map((c, i) => (
                <tr key={c.id}>
                  <td className={tdCls}>{i + 1}</td>
                  <td className={tdCls}>
                    {fmtNum(c.lengthCm, 1)} × {fmtNum(c.widthCm, 1)} × {fmtNum(c.heightCm, 1)}
                  </td>
                  <td className={tdCls}>{fmtCbm(c.cbm)}</td>
                  <td className={tdCls}>{fmtKg(c.grossWeightKg)}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Photos">
            <Attachments items={r.attachments} />
            {can(user.role, "receiving:edit") && (
              <ActionForm action={photoAction} submitLabel="Upload" inline className="mt-3" resetOnSuccess>
                <input type="hidden" name="receivingId" value={r.id} />
                <input type="file" name="photos" accept="image/*" capture="environment" multiple required className="text-sm" />
              </ActionForm>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Package">
            <Dl
              items={[
                ["Purchase", r.supplierOrder ? <A key="p" href={`/purchasing/${r.supplierOrder.id}`}>{docNo("purchase", r.supplierOrder.number)}</A> : "—"],
                ["Tracking no.", r.trackingNo],
                ["Carton mark", r.cartonMark],
                ["Cartons", r.cartonCount],
                ["Net weight", fmtKg(r.netWeightKg)],
                ["Gross weight", fmtKg(r.grossWeightKg)],
                ["CBM", fmtCbm(r.cbm)],
                ["Method", humanize(r.shippingMethod)],
                ["Freight share", fmtBdt(r.freightShareBdt)],
                ["Repacked from", r.repackedFrom.map((x) => docNo("receiving", x.number)).join(", ") || "—"],
                ["Notes", r.notes],
              ]}
            />
          </Card>
          <Card title="Shipment">
            <p className="text-sm">
              {r.shipment ? (
                <>
                  <A href={`/shipments/${r.shipment.id}`}>{r.shipment.code}</A> <Badge value={r.shipment.status} />
                </>
              ) : (
                "Not assigned"
              )}
            </p>
            {canMove && (
              <ActionForm action={moveAction} submitLabel="Move" inline className="mt-3">
                <input type="hidden" name="receivingId" value={r.id} />
                <select name="shipmentId" className={`${inputCls} max-w-[16rem]`} defaultValue={r.shipmentId ?? ""}>
                  {!r.shipmentId && <option value="">Choose shipment…</option>}
                  {options.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} ({s.status.toLowerCase()})
                    </option>
                  ))}
                  {r.shipmentId && <option value="none">Remove from shipment</option>}
                </select>
              </ActionForm>
            )}
          </Card>
          {r.issues.length > 0 && (
            <Card title="Issues">
              <ul className="space-y-1 text-sm">
                {r.issues.map((i) => (
                  <li key={i.id}>
                    <A href={`/issues?id=${i.id}`}>{docNo("issue", i.number)}</A> <Badge value={i.type} /> <Badge value={i.status} /> {i.description}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
