import type { ReactNode } from "react";

/**
 * Quiet background for the sign-in / sign-up pages (staff and portal): a soft
 * gradient, a faint dot grid and two dashed shipping routes (sea and air)
 * between China and Bangladesh. Drawn in code – no image files to load.
 */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {/* dot grid, fading towards the edges */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: "radial-gradient(circle, rgb(148 163 184 / 0.35) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
        {/* soft colour glows */}
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-sky-200/40 blur-3xl" />
        {/* shipping routes */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" fill="none">
          <g stroke="#2563eb" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round">
            <path d="M80 620 C 380 420, 760 760, 1120 520" />
            <path d="M120 300 C 420 110, 820 190, 1100 360" />
          </g>
          <g fill="#2563eb" fillOpacity="0.22">
            <circle cx="80" cy="620" r="6" />
            <circle cx="1120" cy="520" r="6" />
            <circle cx="120" cy="300" r="5" />
            <circle cx="1100" cy="360" r="5" />
          </g>
          {/* cargo ship on the sea route */}
          <g transform="translate(560 585)" fill="#2563eb" fillOpacity="0.2">
            <rect x="-14" y="-16" width="9" height="8" rx="1" />
            <rect x="-3" y="-16" width="9" height="8" rx="1" />
            <rect x="8" y="-16" width="9" height="8" rx="1" />
            <path d="M-26 -6h56l-8 14h-40z" />
          </g>
          {/* plane on the air route */}
          <g transform="translate(640 168) rotate(8)" fill="#2563eb" fillOpacity="0.2">
            <path d="M-22 0 L18 -3 L24 0 L18 3 Z" />
            <path d="M-2 -1 L-10 -16 L-4 -16 L8 -1 Z" />
            <path d="M-2 1 L-10 16 L-4 16 L8 1 Z" />
            <path d="M-20 -1 L-24 -8 L-20 -8 L-14 -1 Z" />
          </g>
        </svg>
      </div>
      {children}
    </div>
  );
}
