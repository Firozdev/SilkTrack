"use client";

import { useMemo, useRef, useState } from "react";

type Point = { date: string; rate: string };

const W = 720;
const H = 220;
const PAD = { l: 48, r: 16, t: 12, b: 28 };
const SERIES = "#2a78d6";

/** Single-series line chart of the RMB→BDT rate with crosshair tooltip. */
export function RateChart({ points }: { points: Point[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const vals = points.map((p) => Number(p.rate));
    const times = points.map((p) => Date.parse(p.date));
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }
    const padY = (max - min) * 0.1;
    min -= padY;
    max += padY;
    const t0 = Math.min(...times);
    const t1 = Math.max(...times) || t0 + 1;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    const xy = points.map((p, i) => ({ x: x(times[i]), y: y(vals[i]), ...p }));
    const ticks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * (i + 0.5)) / 4);
    return { xy, ticks, y };
  }, [points]);

  if (points.length < 2) return <p className="text-sm text-gray-400">Enter at least two days of rates to see the trend.</p>;

  const path = geo.xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  const h = hover !== null ? geo.xy[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    geo.xy.forEach((p, i) => {
      if (Math.abs(p.x - px) < Math.abs(geo.xy[best].x - px)) best = i;
    });
    setHover(best);
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`RMB to BDT rate from ${points[0].date} to ${points[points.length - 1].date}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.l - 6} y={geo.y(t) + 4} textAnchor="end" fontSize={11} fill="#52514e">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} fontSize={11} fill="#52514e">
          {points[0].date}
        </text>
        <text x={W - PAD.r} y={H - 8} fontSize={11} fill="#52514e" textAnchor="end">
          {points[points.length - 1].date}
        </text>
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <>
            <line x1={h.x} x2={h.x} y1={PAD.t} y2={H - PAD.b} stroke="#9ca3af" strokeWidth={1} />
            <circle cx={h.x} cy={h.y} r={5} fill={SERIES} stroke="#fcfcfb" strokeWidth={2} />
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(h.x / W) * 100}%`, transform: h.x > W / 2 ? "translateX(-105%)" : "translateX(5%)" }}
        >
          <div className="text-gray-500">{h.date}</div>
          <div className="font-semibold text-gray-900">1 RMB = {Number(h.rate).toFixed(4)} BDT</div>
        </div>
      )}
    </div>
  );
}
