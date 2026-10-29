import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import type { DB } from "./client";
import type { Tx } from "./base";
import * as t from "./schema";
import type { PlanResult } from "@/domain/planner";

/*
 * A run's plan is frozen when the run is confirmed, so it can be compared
 * with what really happened. It is saved as JSON, where exact numbers
 * (Decimal) become text. Read it only through frozenPlan(), which turns them
 * back into numbers, so `.plus()` works and `+` never glues texts together.
 */

/** The JSON a plan is saved as. Decimals become their exact text ("12.5"). */
export const freezePlan = (plan: PlanResult): unknown => JSON.parse(JSON.stringify(plan));

const num = (v: unknown) => new Decimal(v as Decimal.Value);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : num(v));
const numOrUndefined = (v: unknown) => (v === null || v === undefined ? undefined : num(v));

/** A saved plan as numbers again. */
export function thawPlan(data: unknown): PlanResult {
  const p = data as PlanResult;
  return {
    issues: p.issues ?? [],
    products: (p.products ?? []).map((l) => ({ ...l, rejectRate: numOrNull(l.rejectRate) })),
    sauces: (p.sauces ?? []).map((s) => ({
      ...s,
      litresNeeded: num(s.litresNeeded),
      litresPerBatch: numOrNull(s.litresPerBatch),
      surplusLitres: numOrNull(s.surplusLitres),
    })),
    requirements: (p.requirements ?? []).map((r) => ({
      ...r,
      required: numOrNull(r.required),
      contributions: (r.contributions ?? []).map((c) => ({ ...c, quantity: numOrNull(c.quantity) })),
      stillToUse: numOrUndefined(r.stillToUse),
      onHand: numOrNull(r.onHand),
      reservedEarlier: num(r.reservedEarlier ?? 0),
      available: numOrNull(r.available),
      onOrder: num(r.onOrder ?? 0),
      lateOnOrder: numOrUndefined(r.lateOnOrder),
      toBuy: numOrNull(r.toBuy),
    })),
  };
}

/** The plan frozen when the run was confirmed, or null for a draft. */
export async function frozenPlan(db: DB | Tx, runId: string): Promise<PlanResult | null> {
  const [snap] = await db.select({ data: t.forecastSnapshots.data }).from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, runId));
  return snap ? thawPlan(snap.data) : null;
}
