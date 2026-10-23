"use client";

import { buttonClass } from "@/components/ui/button";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("primary")} onClick={() => window.print()}>
      {label}
    </button>
  );
}
