"use client";

import { useState } from "react";
import { btnCls, inputCls } from "./ui";

type Row = { key: number; l: string; w: string; h: string; kg?: string };
export type CartonInit = { l: string; w: string; h: string; kg?: string };

/** Carton dimension rows with live CBM: (L × W × H) / 1,000,000. Optional prefilled rows. */
export function CartonRows({ prefix = "c", initial }: { prefix?: string; initial?: CartonInit[] }) {
  const [rows, setRows] = useState<Row[]>(() => (initial?.length ? initial.map((c, key) => ({ key, ...c })) : [{ key: 0, l: "", w: "", h: "" }]));
  const cbm = (r: Row) => {
    const v = (Number(r.l) * Number(r.w) * Number(r.h)) / 1_000_000;
    return Number.isFinite(v) ? v : 0;
  };
  const total = rows.reduce((a, r) => a + cbm(r), 0);
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-7">
          <span className="col-span-2 text-xs font-medium text-gray-500 sm:col-span-1 sm:pb-2">Carton {i + 1}</span>
          {(["l", "w", "h"] as const).map((d) => (
            <label key={d} className="block">
              <span className="text-xs text-gray-500">{d.toUpperCase()} cm</span>
              <input
                name={`${prefix}.${r.key}.${d === "l" ? "lengthCm" : d === "w" ? "widthCm" : "heightCm"}`}
                inputMode="decimal"
                required
                value={r[d]}
                onChange={(e) => set(r.key, { [d]: e.target.value })}
                className={inputCls}
              />
            </label>
          ))}
          <label className="block">
            <span className="text-xs text-gray-500">Weight kg</span>
            <input name={`${prefix}.${r.key}.grossWeightKg`} value={r.kg ?? ""} onChange={(e) => set(r.key, { kg: e.target.value })} inputMode="decimal" className={inputCls} />
          </label>
          <span className="pb-2 text-xs text-gray-600">{cbm(r).toFixed(4)} m³</span>
          {rows.length > 1 && (
            <button type="button" className={`${btnCls} sm:mb-0.5`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className={btnCls} onClick={() => setRows([...rows, { key: Math.max(...rows.map((x) => x.key)) + 1, l: "", w: "", h: "" }])}>
          + Carton
        </button>
        <span className="text-sm">
          Total CBM: <b>{total.toFixed(4)} m³</b>
        </span>
      </div>
    </div>
  );
}
