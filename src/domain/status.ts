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

export type PoStatus = keyof typeof PO_STATUS_NAME;

/** Sent to the supplier and not all arrived yet: what "on order" and "on the way" count. */
export const PO_ON_THE_WAY = ["sent", "partly_received"] as const satisfies readonly PoStatus[];
/** Still being worked on: a draft or on the way. */
export const PO_OPEN = ["draft", ...PO_ON_THE_WAY] as const satisfies readonly PoStatus[];
/** Finished: nothing more will arrive. */
export const PO_DONE = ["received", "closed", "cancelled"] as const satisfies readonly PoStatus[];

export const isOnTheWay = (status: string) => (PO_ON_THE_WAY as readonly string[]).includes(status);
export const isPoDone = (status: string) => (PO_DONE as readonly string[]).includes(status);

export const SALES_STATUS_NAME = {
  pending: "To deliver",
  delivered: "Delivered",
  cancelled: "Cancelled",
} as const;

/** Why jars left stock (an outflow), in the words of the screens and the history. */
export const OUTFLOW_NAME = {
  sale: "Sale",
  internal_use: "Own use",
  test: "Test",
  sample: "Sample / gift",
  waste: "Waste / loss",
} as const;

/** A stock correction (Stock → Correct stock). */
export const ADJUSTMENT_NAME: Record<string, string> = { count_correction: "Stock count", waste: "Write-off", internal_use: "Own use", sample: "Sample" };

/** What went wrong in a batch. */
export const INCIDENT_NAME = { loss: "Loss", spill: "Spill", quality: "Quality", other: "Other" } as const;

/** A status name to use inside a sentence: "in production", "done". */
export const inSentence = (names: Readonly<Record<string, string>>, status: string) => (names[status] ?? status.replace(/_/g, " ")).toLowerCase();
