export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "warn" },
  confirmed: { label: "Confirmed", cls: "ok" },
  in_progress: { label: "In production", cls: "ok" },
  closed: { label: "Closed", cls: "" },
  cancelled: { label: "Cancelled", cls: "" },
};

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "warn" },
  sent: { label: "Ordered", cls: "warn" },
  partly_received: { label: "Partly received", cls: "warn" },
  received: { label: "Received", cls: "ok" },
  cancelled: { label: "Cancelled", cls: "" },
};

export const MOVEMENT: Record<string, string> = {
  opening_balance: "Opening count",
  receipt: "Delivery",
  consumption: "Used in production",
  production_output: "Produced",
  packaging_output: "Packed",
  sale: "Sale",
  sample: "Sample",
  waste: "Waste",
  internal_use: "Internal use",
  count_correction: "Count correction",
  reversal: "Reversal",
};
