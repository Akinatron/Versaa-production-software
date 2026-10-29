import { INCIDENT_NAME, OUTFLOW_NAME, PO_STATUS_NAME, RUN_STATUS_NAME, SALES_STATUS_NAME } from "@/domain/status";

export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: RUN_STATUS_NAME.draft, cls: "neutral" },
  confirmed: { label: RUN_STATUS_NAME.confirmed, cls: "info" },
  in_progress: { label: RUN_STATUS_NAME.in_progress, cls: "info" },
  closed: { label: RUN_STATUS_NAME.closed, cls: "ok" },
  cancelled: { label: RUN_STATUS_NAME.cancelled, cls: "" },
};

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: PO_STATUS_NAME.draft, cls: "warn" },
  sent: { label: PO_STATUS_NAME.sent, cls: "info" },
  partly_received: { label: PO_STATUS_NAME.partly_received, cls: "info" },
  received: { label: PO_STATUS_NAME.received, cls: "ok" },
  closed: { label: PO_STATUS_NAME.closed, cls: "" },
  cancelled: { label: PO_STATUS_NAME.cancelled, cls: "" },
};

export const MOVEMENT: Record<string, string> = {
  opening_balance: "Opening count",
  receipt: "Delivery",
  consumption: "Used in production",
  production_output: "Produced",
  packaging_output: "Packed",
  ...OUTFLOW_NAME,
  count_correction: "Count correction",
  reversal: "Reversal",
};

export const BATCH_STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: "To cook", cls: "neutral" },
  in_production: { label: "Cooking", cls: "info" },
  awaiting_packaging: { label: "To pack", cls: "info" },
  packing: { label: "Packing", cls: "info" },
  closed: { label: "Closed", cls: "ok" },
  cancelled: { label: "Not made", cls: "" },
};

export const SALES_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: SALES_STATUS_NAME.pending, cls: "info" },
  delivered: { label: SALES_STATUS_NAME.delivered, cls: "ok" },
  cancelled: { label: SALES_STATUS_NAME.cancelled, cls: "" },
};

/** Reasons a jar leaves stock, in the order they're offered. Only "sale" counts as sales. */
export const OUTFLOW_REASONS = ["sale", "internal_use", "test", "sample", "waste"] as const;
export type OutflowReason = (typeof OUTFLOW_REASONS)[number];

export const OUTFLOW: Record<string, string> = OUTFLOW_NAME;

export const OUTFLOW_EXPLAIN: Record<OutflowReason, string> = {
  sale: "Jars sold to a customer. The only reason that counts as sales.",
  internal_use: "Jars the team uses itself: cooking, staff, the office.",
  test: "Jars opened for tests and trials: quality checks, shelf-life, new recipes.",
  sample: "Jars given away for free: tastings, samples for shops, gifts.",
  waste: "Jars thrown away: broken, spoiled or failed a check. Say why in the note.",
};

/** Badge colour for an outbound reason. */
export const outflowBadge = (type: string) => (type === "sale" ? "ok" : type === "waste" ? "bad" : "neutral");

export const INCIDENT: Record<string, string> = INCIDENT_NAME;
