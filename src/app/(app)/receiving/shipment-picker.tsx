"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

type Method = "AIR" | "SEA";
export type PickerShipment = { id: string; code: string; method: Method; status: string };

/**
 * "Ship by" + "Assign to shipment": only Open / Upcoming shipments of the chosen
 * method are listed (the server also refuses any other). Changing the method
 * clears the chosen shipment back to the suggested one.
 */
export function ShipmentPicker({ method: initial, shipments }: { method: Method; shipments: PickerShipment[] }) {
  const [method, setMethod] = useState<Method>(initial);
  const [shipmentId, setShipmentId] = useState("auto");
  const options = shipments.filter((s) => s.method === method && (s.status === "OPEN" || s.status === "UPCOMING"));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Ship by">
        <select
          name="shippingMethod"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as Method);
            setShipmentId("auto");
          }}
          className={inputCls}
        >
          <option value="AIR">Air</option>
          <option value="SEA">Sea</option>
        </select>
      </Field>
      <Field label="Assign to shipment" hint={`Only open / upcoming ${method.toLowerCase()} shipments. Suggested: the open one; after cut-off, next week's.`}>
        <select name="shipmentId" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} className={inputCls}>
          <option value="auto">Suggested (open {method.toLowerCase()} shipment)</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} ({s.status.toLowerCase()})
            </option>
          ))}
          <option value="none">Don&apos;t assign yet</option>
        </select>
      </Field>
    </div>
  );
}
