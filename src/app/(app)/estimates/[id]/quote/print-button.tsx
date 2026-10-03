"use client";

import { btnPrimaryCls } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={btnPrimaryCls}>
      Print / Save as PDF
    </button>
  );
}
