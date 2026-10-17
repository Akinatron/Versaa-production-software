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

export const BATCH_STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "warn" },
  in_production: { label: "In production", cls: "warn" },
  awaiting_packaging: { label: "Awaiting packaging", cls: "warn" },
  packing: { label: "Packing", cls: "warn" },
  closed: { label: "Closed", cls: "ok" },
  cancelled: { label: "Not made", cls: "" },
};

export const SALES_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "warn" },
  delivered: { label: "Delivered", cls: "ok" },
  cancelled: { label: "Cancelled", cls: "" },
};

export const OUTFLOW: Record<string, string> = {
  sale: "Sale",
  sample: "Sample",
  waste: "Waste",
  internal_use: "Internal use",
};

export const INCIDENT: Record<string, string> = {
  loss: "Loss",
  spill: "Spill",
  quality: "Quality",
  other: "Other",
};
