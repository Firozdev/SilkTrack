"use client";

import { useEffect, useState } from "react";

/** Logo picker with a preview of the current or newly chosen file. */
export function LogoInput({ current }: { current: string | null }) {
  const [preview, setPreview] = useState<string | null>(current);
  const [remove, setRemove] = useState(false);
  useEffect(() => () => void (preview?.startsWith("blob:") && URL.revokeObjectURL(preview)), [preview]);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50">
        {preview && !remove ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded file
          <img src={preview} alt="Logo preview" className="max-h-20 max-w-36 object-contain" />
        ) : (
          <span className="text-xs text-gray-400">No logo</span>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setPreview(URL.createObjectURL(f));
              setRemove(false);
            }
          }}
        />
        <p className="text-xs text-gray-500">PNG, JPG or SVG, up to 2 MB. Choosing a file replaces the current logo when you save.</p>
        {current && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" name="removeLogo" value="yes" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Remove the logo
          </label>
        )}
      </div>
    </div>
  );
}
