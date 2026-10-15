/** SilkTruck mark – a cargo ship with containers (same as the browser-tab icon, src/app/icon.svg) – with the name. */
export function Logo({ name = "SilkTruck", size = 24, className = "" }: { name?: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
        <rect width="64" height="64" rx="14" fill="#2563eb" />
        <rect x="17" y="17" width="9" height="9" rx="1" fill="#fff" />
        <rect x="28" y="17" width="9" height="9" rx="1" fill="#fff" />
        <rect x="28" y="7" width="9" height="9" rx="1" fill="#fff" opacity=".7" />
        <rect x="39" y="17" width="9" height="9" rx="1" fill="#fff" opacity=".7" />
        <path d="M8 29h48l-6 13H14z" fill="#fff" />
        <path d="M8 50c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span>{name}</span>
    </span>
  );
}
