export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "warn" },
  confirmed: { label: "Confirmed", cls: "ok" },
  in_progress: { label: "In production", cls: "ok" },
  closed: { label: "Closed", cls: "" },
  cancelled: { label: "Cancelled", cls: "" },
};

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "warn" },
  sent: { label: "Sent", cls: "warn" },
  partly_received: { label: "Partly received", cls: "warn" },
  received: { label: "Received", cls: "ok" },
  closed: { label: "Closed (not all arrived)", cls: "" },
  cancelled: { label: "Cancelled", cls: "" },
};

export const MOVEMENT: Record<string, string> = {
  opening_balance: "Opening count",
  receipt: "Delivery",
  consumption: "Used in production",
  production_output: "Produced",
  packaging_output: "Packed",
  sale: "Sale",
  sample: "Sample / gift",
  waste: "Waste / loss",
  internal_use: "Own use",
  test: "Test",
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

/** Reasons a jar leaves stock, in the order they're offered. Only "sale" counts as sales. */
export const OUTFLOW_REASONS = ["sale", "internal_use", "test", "sample", "waste"] as const;
export type OutflowReason = (typeof OUTFLOW_REASONS)[number];

export const OUTFLOW: Record<string, string> = {
  sale: "Sale",
  internal_use: "Own use",
  test: "Test",
  sample: "Sample / gift",
  waste: "Waste / loss",
};

export const OUTFLOW_EXPLAIN: Record<OutflowReason, string> = {
  sale: "Jars sold to a customer. The only reason that counts as sales.",
  internal_use: "Jars the team uses itself: cooking, staff, the office.",
  test: "Jars opened for tests and trials: quality checks, shelf-life, new recipes.",
  sample: "Jars given away for free: tastings, samples for shops, gifts.",
  waste: "Jars thrown away: broken, spoiled or failed a check. Say why in the note.",
};

/** Badge colour for an outbound reason. */
export const outflowBadge = (type: string) => (type === "sale" ? "ok" : type === "waste" ? "bad" : "warn");

export const INCIDENT: Record<string, string> = {
  loss: "Loss",
  spill: "Spill",
  quality: "Quality",
  other: "Other",
};
