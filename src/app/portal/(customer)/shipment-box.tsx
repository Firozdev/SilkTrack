import { Card, Dl } from "@/components/ui";
import { fmtDay } from "@/lib/dates";
import type { PortalShipment } from "@/server/portal";
import type { Dict, Lang } from "../i18n";
import { portalLabel } from "../labels";

/** Which shipment the order travels in and when it should reach Bangladesh (live from the shipment). */
export function ShipmentBox({ t, lang, data, showProducts }: { t: Dict; lang: Lang; data: { shipments: PortalShipment[]; unassigned: string[] }; showProducts: boolean }) {
  const { shipments, unassigned } = data;
  return (
    <Card title={t.shipmentBox}>
      {shipments.length === 0 && <p className="text-sm text-gray-500">{t.notAssignedShipment}</p>}
      <div className="space-y-4">
        {shipments.map((s) => (
          <div key={s.code} className={shipments.length > 1 ? "border-b border-gray-100 pb-3 last:border-0 last:pb-0" : ""}>
            <Dl
              items={[
                [t.shipmentCode, <span key="c" className="font-medium">{s.code} <span className="font-normal text-gray-500">· {portalLabel(s.status, lang)}</span></span>],
                [t.shipmentStart, fmtDay(s.startDate)],
                [t.departureDate, s.departure.date ? `${fmtDay(s.departure.date)}${s.departure.planned ? ` (${t.planned})` : ""}` : "—"],
                [t.bdReceiveDate, s.bdReceive.date ? `${fmtDay(s.bdReceive.date)}${s.bdReceive.actual ? ` (${t.arrivedTag})` : ` (${t.estimated})`}` : "—"],
                ...(showProducts ? ([[t.products, s.products.join(", ")]] as [string, string][]) : []),
              ]}
            />
          </div>
        ))}
      </div>
      {shipments.length > 0 && unassigned.length > 0 && (
        <p className="mt-3 text-sm text-gray-500">
          {t.notAssignedShipment}: {unassigned.join(", ")}
        </p>
      )}
    </Card>
  );
}
