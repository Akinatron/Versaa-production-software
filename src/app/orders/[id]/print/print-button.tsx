"use client";

import { useEffect } from "react";

/** Opens the print dialog once the page is shown (Save as PDF is in that dialog), and offers a button to open it again. */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <button type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
