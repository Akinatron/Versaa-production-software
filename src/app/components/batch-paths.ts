/** The three steps of a batch, all under /batches/[id]. */
export type BatchStep = "cook" | "pack" | "close";

export const batchHref = (id: string, step: BatchStep) => `/batches/${id}/${step}`;

/**
 * The step a batch is waiting on: ingredients still to record → cook; cooked but no jars yet → pack;
 * otherwise (packed, closed or not made) → close, where the summary is.
 */
export function batchStepFor(b: { status: string; pending: number; sessions: number }): BatchStep {
  if (b.status === "closed" || b.status === "cancelled") return "close";
  if (b.pending > 0 || b.status === "planned") return "cook";
  if (b.sessions === 0) return "pack";
  return "close";
}
