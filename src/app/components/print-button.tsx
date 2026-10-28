"use client";

import { useEffect } from "react";

/** A button that opens the print dialog (Save as PDF is in that dialog). With `auto`, the dialog also opens once the page is shown. */
export function PrintButton({ label, auto = false }: { label: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <button type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
