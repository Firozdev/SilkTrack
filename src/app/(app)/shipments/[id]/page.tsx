import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { A, Alert, Badge, Card, Dl, Field, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { fmtDateTime, fmtDay, toYmd } from "@/lib/dates";
import { docNo, fmtBdt, fmtCbm, fmtKg, fmtNum, fmtRate, humanize } from "@/lib/format";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { SHIPMENT_FLOW, capacityWarning, isAccepting } from "@/server/shipments";
import { detailsAction, freightAction, statusAction } from "../actions";

export default async function ShipmentPage({ params }: PageProps<"/shipments/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const s = await prisma.shipment.findUnique({
    where: { id },
    include: {
      samples: { where: { status: { not: "CANCELLED" } }, orderBy: { number: "asc" }, include: { customer: { select: { code: true, name: true } }, lines: true } },
      receivings: {
        where: { status: { not: "REPACKED" } },
        orderBy: { number: "asc" },
        include: {
          lines: { include: { orderLine: { select: { productName: true, order: { select: { id: true, number: true, customer: { select: { code: true, name: true } } } } } } } },
        },
      },
    },
  });
  if (!s) notFound();
  const canEdit = can(user.role, "shipment:edit");
  const idx = SHIPMENT_FLOW.indexOf(s.status);
  const next = SHIPMENT_FLOW.slice(idx + 1).filter((st) => st !== "UPCOMING" && (can(user.role, "bdReceiving:edit") || SHIPMENT_FLOW.indexOf(st) < SHIPMENT_FLOW.indexOf("ARRIVED_BD")));
  const warning = capacityWarning(s);
  const cutoffPassed = (s.status === "OPEN" || s.status === "UPCOMING") && !isAccepting(s);

  // Group parcels by customer for the manifest view.
  const byCustomer = new Map<string, { name: string; parcels: typeof s.receivings }>();
  for (const r of s.receivings) {
    const c = r.lines[0]?.orderLine.order.customer;
    const key = c ? c.code : "—";
    const g = byCustomer.get(key) ?? { name: c?.name ?? "", parcels: [] };
    g.parcels.push(r);
    byCustomer.set(key, g);
  }

  return (
    <>
      <PageHeader
        title={s.code}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={s.status} /> {humanize(s.method)} · week {s.weekNumber}, {s.year}
          </span>
        }
        actions={
          <a href={`/shipments/${s.id}/packing-list`} className={btnCls}>
            ⬇ Packing list (Excel CSV)
          </a>
        }
      />
      {warning && <Alert tone="warn">⚠ {warning}</Alert>}
      {cutoffPassed && <Alert tone="warn">Cut-off has passed. Close the shipment; new items go to next week&apos;s shipment.</Alert>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {s.samples.length > 0 && (
            <Card title={`Samples (${s.samples.length})`}>
              <Table head={["Sample", "Customer", "Products", "Cartons", "Weight", "CBM", "Status"]}>
                {s.samples.map((smp) => (
                  <tr key={smp.id}>
                    <td className={tdCls}>
                      <A href={`/samples/${smp.id}`}>{docNo("sample", smp.number)}</A>
                    </td>
                    <td className={tdCls}>
                      {smp.customer.code} · {smp.customer.name}
                    </td>
                    <td className={tdCls}>{smp.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}</td>
                    <td className={tdCls}>{smp.cartonCount ?? 1}</td>
                    <td className={tdCls}>{fmtKg(smp.weightKg)}</td>
                    <td className={tdCls}>{fmtCbm(smp.cbm)}</td>
                    <td className={tdCls}>
                      <Badge value={smp.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          <Card title={`Items by customer (${s.receivings.length} parcels${s.samples.length ? ` + ${s.samples.length} sample(s)` : ""})`}>
            {s.receivings.length === 0 && <p className="text-sm text-gray-400">No items yet.</p>}
            <div className="space-y-4">
              {[...byCustomer.entries()].map(([code, g]) => (
                <div key={code}>
                  <h3 className="mb-1 text-sm font-semibold">
                    {code} · {g.name}
                  </h3>
                  <Table head={["Parcel", "Orders / products", "Cartons", "Gross", "CBM", "Freight share"]}>
                    {g.parcels.map((r) => (
                      <tr key={r.id}>
                        <td className={tdCls}>
                          <A href={`/receiving/${r.id}`}>{docNo("receiving", r.number)}</A>
                          {r.cartonMark && <div className="text-xs text-gray-400">{r.cartonMark}</div>}
                        </td>
                        <td className={tdCls}>
                          {r.lines.map((l) => (
                            <div key={l.id}>
                              <A href={`/requests/${l.orderLine.order.id}`}>{docNo("order", l.orderLine.order.number)}</A> {l.orderLine.productName} × {l.quantityReceived}
                            </div>
                          ))}
                        </td>
                        <td className={tdCls}>{r.cartonCount}</td>
                        <td className={tdCls}>{fmtKg(r.grossWeightKg)}</td>
                        <td className={tdCls}>{fmtCbm(r.cbm)}</td>
                        <td className={tdCls}>{fmtBdt(r.freightShareBdt)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Totals">
            <Dl
              items={[
                ["Parcels", s.itemCount],
                ["Cartons", s.cartonCount],
                ["Net weight", fmtKg(s.netWeightKg)],
                ["Gross weight", `${fmtKg(s.grossWeightKg)}${s.maxWeightKg ? ` / ${fmtNum(s.maxWeightKg, 0)}` : ""}`],
                ["CBM", `${fmtCbm(s.cbm)}${s.maxCbm ? ` / ${fmtNum(s.maxCbm, 2)}` : ""}`],
                ["Chargeable weight", fmtKg(s.chargeableWeightKg)],
                ["Freight", s.freightCost ? `${s.freightCurrency === "RMB" ? "¥" : "৳"}${fmtNum(s.freightCost)}${s.freightRateUsed ? ` @ ${fmtRate(s.freightRateUsed)}` : ""}` : "—"],
                ["Freight (BDT)", fmtBdt(s.freightCostBdt)],
              ]}
            />
          </Card>
          {canEdit && next.length > 0 && (
            <Card title="Update status">
              <p className="mb-2 text-xs text-gray-500">Every order line in this shipment is updated at once.</p>
              <ActionForm action={statusAction} submitLabel="Update" inline>
                <input type="hidden" name="id" value={s.id} />
                <select name="status" className={`${inputCls} max-w-[14rem]`}>
                  {next.map((st) => (
                    <option key={st} value={st}>
                      {humanize(st)}
                    </option>
                  ))}
                </select>
              </ActionForm>
            </Card>
          )}
          <Card title="Schedule & tracking">
            <Dl
              items={[
                ["Cut-off", fmtDay(s.cutoffDate)],
                ["Planned departure", fmtDay(s.plannedDepartureDate)],
                ["ETA Bangladesh", fmtDay(s.etaBd)],
                ["Departed", fmtDateTime(s.departedAt, user.timezone)],
                ["Arrived", fmtDateTime(s.arrivedAt, user.timezone)],
                ["Customs cleared", fmtDateTime(s.customsClearedAt, user.timezone)],
                ["Forwarder", s.forwarder],
                ["Master tracking", s.masterTrackingNo],
              ]}
            />
            {canEdit && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-blue-700">Edit</summary>
                <ActionForm action={detailsAction} className="mt-2">
                  <input type="hidden" name="id" value={s.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Cut-off">
                      <input type="date" name="cutoffDate" defaultValue={toYmd(s.cutoffDate)} required className={inputCls} />
                    </Field>
                    <Field label="Planned departure">
                      <input type="date" name="plannedDepartureDate" defaultValue={s.plannedDepartureDate ? toYmd(s.plannedDepartureDate) : ""} className={inputCls} />
                    </Field>
                    <Field label="ETA BD">
                      <input type="date" name="etaBd" defaultValue={s.etaBd ? toYmd(s.etaBd) : ""} className={inputCls} />
                    </Field>
                    <Field label="Forwarder">
                      <input name="forwarder" defaultValue={s.forwarder ?? ""} className={inputCls} />
                    </Field>
                    <Field label={s.method === "AIR" ? "AWB no." : "B/L / container no."}>
                      <input name="masterTrackingNo" defaultValue={s.masterTrackingNo ?? ""} className={inputCls} />
                    </Field>
                    <Field label="Max kg">
                      <input name="maxWeightKg" defaultValue={s.maxWeightKg?.toString() ?? ""} className={inputCls} />
                    </Field>
                    <Field label="Max CBM">
                      <input name="maxCbm" defaultValue={s.maxCbm?.toString() ?? ""} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <input name="notes" defaultValue={s.notes ?? ""} className={inputCls} />
                  </Field>
                </ActionForm>
              </details>
            )}
          </Card>
          {can(user.role, "shipment:manage") && (
            <Card title="Freight cost">
              <p className="mb-2 text-xs text-gray-500">Split across parcels by {s.method === "AIR" ? "gross weight" : "CBM"}, then across order lines by quantity.</p>
              <ActionForm action={freightAction} submitLabel="Save freight">
                <input type="hidden" name="id" value={s.id} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Freight cost">
                    <input name="freightCost" defaultValue={s.freightCost?.toString() ?? ""} required inputMode="decimal" className={inputCls} />
                  </Field>
                  <Field label="Currency">
                    <select name="freightCurrency" defaultValue={s.freightCurrency ?? "BDT"} className={inputCls}>
                      <option value="BDT">BDT</option>
                      <option value="RMB">RMB</option>
                    </select>
                  </Field>
                  <Field label="Chargeable kg">
                    <input name="chargeableWeightKg" defaultValue={s.chargeableWeightKg?.toString() ?? ""} inputMode="decimal" className={inputCls} />
                  </Field>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
