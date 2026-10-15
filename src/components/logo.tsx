/** SilkTruck mark (same as the browser-tab icon, src/app/icon.svg) with the name. */
export function Logo({ name = "SilkTruck", size = 24, className = "" }: { name?: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
        <rect width="64" height="64" rx="14" fill="#2563eb" />
        <path d="M10 20h26v20H10z" fill="#fff" />
        <path d="M36 26h9l7 8v6H36z" fill="#fff" />
        <path d="M40 29h4.5l4 5H40z" fill="#2563eb" />
        <circle cx="19" cy="42" r="5" fill="#fff" stroke="#2563eb" strokeWidth="2.5" />
        <circle cx="45" cy="42" r="5" fill="#fff" stroke="#2563eb" strokeWidth="2.5" />
      </svg>
      <span>{name}</span>
    </span>
  );
}
