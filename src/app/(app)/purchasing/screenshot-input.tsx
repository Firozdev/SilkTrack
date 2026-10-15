"use client";

import { useEffect, useRef, useState } from "react";

type Picked = { file: File; url: string | null };

/** Optional screenshots (supplier order / payment proof) with thumbnails; each can be removed before saving. */
export function ScreenshotInput({ name = "invoice" }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  useEffect(() => () => picked.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [picked]);

  const sync = (files: File[]) => {
    // Keep the real <input> in step with what is shown, so the form sends exactly these files.
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    if (ref.current) ref.current.files = dt.files;
    setPicked(files.map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null })));
  };

  return (
    <div className="space-y-2">
      <input ref={ref} type="file" name={name} accept="image/*,application/pdf" multiple className="text-sm" onChange={(e) => sync([...(e.target.files ?? [])])} />
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {picked.map((p, i) => (
            <li key={`${p.file.name}-${i}`} className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of a file not uploaded yet
                <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
              ) : (
                <span className="px-1 text-center text-[10px] text-gray-500">{p.file.name}</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${p.file.name}`}
                onClick={() => sync(picked.filter((_, n) => n !== i).map((x) => x.file))}
                className="absolute right-0.5 top-0.5 rounded bg-white/90 px-1 text-xs leading-4 text-gray-700 shadow hover:text-red-700"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
