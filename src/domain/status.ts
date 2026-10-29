/**
 * The names people see for each status, shared by the screens (badges) and
 * by messages, so an error never shows an internal word like "in_progress".
 */
export const RUN_STATUS_NAME = {
  draft: "Draft",
  confirmed: "Confirmed",
  in_progress: "In production",
  closed: "Done",
  cancelled: "Cancelled",
} as const;

export const PO_STATUS_NAME = {
  draft: "Draft, not sent",
  sent: "Sent",
  partly_received: "Partly received",
  received: "Received",
  closed: "Closed (not all arrived)",
  cancelled: "Cancelled",
} as const;

export const SALES_STATUS_NAME = {
  pending: "To deliver",
  delivered: "Delivered",
  cancelled: "Cancelled",
} as const;

/** A status name to use inside a sentence: "in production", "done". */
export const inSentence = (names: Readonly<Record<string, string>>, status: string) => (names[status] ?? status.replace(/_/g, " ")).toLowerCase();
