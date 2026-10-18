import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { loadPlanCatalog, loadStockPositions } from "./planning";
import { planProduction, type PlanResult } from "@/domain/planner";
import { createBatchesForRun } from "./production";
import { diff, logChange, needReason } from "./changes";

/*
 * Recording actions. Each one:
 * - runs in a single transaction, so it either happens completely or not at all;
 * - takes an idempotency key, so repeating it (double click, reload, retry)
 *   returns the first result instead of recording twice;
 * - only ever adds stock movements, never edits them.
 */

export { OperationError, today, positive, itemsById, checkWholeUnits, nextLotCode, type Tx } from "./base";
import { OperationError, today, positive, itemsById, checkWholeUnits, nextLotCode } from "./base";

// ---------------------------------------------------------------- stock count

export interface OpeningLine {
  itemId: string;
  quantity: Decimal.Value;
  supplierBatch?: string | null;
  bestBefore?: string | null;
}

/**
 * Record the first stock count for items that have never been counted.
 * Each line becomes its own lot, so it can be traced later like any delivery.
 */
export async function recordOpeningCount(db: DB, input: { idempotencyKey: string; countedOn?: string; lines: OpeningLine[] }) {
  const lines = input.lines.filter((l) => String(l.quantity).trim() !== "");
  if (lines.length === 0) throw new OperationError("Enter at least one quantity.");
  return db.transaction(async (tx) => {
    const done = await tx.select().from(t.movements).where(sql`${t.movements.idempotencyKey} like ${input.idempotencyKey + ":%"}`);
    if (done.length > 0) return { created: 0, alreadyRecorded: true };

    const items = await itemsById(tx, lines.map((l) => l.itemId));
    const counted = await tx
      .selectDistinct({ itemId: t.movements.itemId })
      .from(t.movements)
      .where(inArray(t.movements.itemId, [...items.keys()]));
    if (counted.length > 0) {
      const names = counted.map((c) => items.get(c.itemId)?.name).join(", ");
      throw new OperationError(`Already counted: ${names}. Later changes are recorded as corrections, not opening counts.`);
    }

    const on = input.countedOn ?? today();
    let i = 0;
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new OperationError("Unknown item.");
      const qty = new Decimal(line.quantity);
      if (qty.isNaN() || qty.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
      checkWholeUnits(item, qty);
      const code = await nextLotCode(tx, `OPEN-${on.replaceAll("-", "")}`);
      const [lot] = await tx
        .insert(t.lots)
        .values({ itemId: item.id, code, supplierBatch: line.supplierBatch || null, bestBefore: line.bestBefore || null, receivedOn: on })
        .returning();
      await tx.insert(t.movements).values({
        lotId: lot!.id,
        itemId: item.id,
        quantity: qty.toString(),
        type: "opening_balance",
        occurredAt: new Date(`${on}T00:00:00Z`),
        reason: "Opening stock count",
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
      await logChange(tx, {
        action: "create",
        area: "stock",
        entity: { type: "lot", id: lot!.id, code },
        summary: `Opening count: ${qty} ${item.stockUnit} of ${item.name}`,
        links: [{ type: "item", id: item.id, code: item.name }],
      });
    }
    return { created: lines.length, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- suppliers

export async function addSupplier(db: DB, input: { name: string; contact?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Supplier name is required.");
  const [row] = await db.insert(t.suppliers).values({ name, contact: input.contact?.trim() || null }).returning();
  await logChange(db, { action: "create", area: "purchasing", entity: { type: "supplier", id: row!.id, code: name }, summary: `Added supplier ${name}` });
  return row!;
}

// ---------------------------------------------------------------- purchase orders and deliveries

export {
  createPurchaseOrder,
  createOrdersFromPlan,
  updateDraftOrder,
  markOrderSent,
  cancelPurchaseOrder,
  closePurchaseOrder,
  recordReceipt,
  type OrderLine,
  type ReceiptLineInput,
} from "./purchasing";

// ---------------------------------------------------------------- production runs

export async function createRun(db: DB, input: { idempotencyKey: string; plannedFor: string; targets: Record<string, number> }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.plannedFor)) throw new OperationError("Choose a production date.");
  const targets = Object.entries(input.targets).filter(([, n]) => n > 0);
  if (targets.length === 0) throw new OperationError("Enter at least one jar target.");
  for (const [, n] of targets) if (!Number.isInteger(n)) throw new OperationError("Jar targets must be whole numbers.");
  return db.transaction(async (tx) => {
    const code = `RUN-${input.plannedFor.replaceAll("-", "")}-${input.idempotencyKey.slice(0, 4).toUpperCase()}`;
    const [existing] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.code, code));
    if (existing) return existing;
    const [run] = await tx.insert(t.productionRuns).values({ code, plannedFor: input.plannedFor }).returning();
    await tx.insert(t.runTargets).values(targets.map(([productId, n]) => ({ runId: run!.id, productId, targetJars: n })));
    const total = targets.reduce((s, [, n]) => s + n, 0);
    await logChange(tx, {
      action: "create",
      area: "production",
      entity: { type: "run", id: run!.id, code },
      summary: `Draft run ${code} saved for ${input.plannedFor}: ${total} jars`,
    });
    return run!;
  });
}

export async function runTargets(db: DB, runId: string) {
  const rows = await db.select().from(t.runTargets).where(eq(t.runTargets.runId, runId));
  return Object.fromEntries(rows.map((r) => [r.productId, r.targetJars]));
}

/** Plan for a run, treating stock reserved by other runs as unavailable. */
export async function planForRun(db: DB, runId: string): Promise<PlanResult> {
  const [catalog, stock, targets, own] = await Promise.all([
    loadPlanCatalog(db),
    loadStockPositions(db),
    runTargets(db, runId),
    db.select().from(t.reservations).where(and(eq(t.reservations.runId, runId), isNull(t.reservations.releasedAt))),
  ]);
  // Stock positions count every reservation; give this run's own back.
  for (const r of own) {
    const pos = stock[r.itemId];
    if (pos) pos.reservedEarlier = pos.reservedEarlier.minus(r.quantity);
  }
  return planProduction({ ...catalog, stock, targets });
}

/**
 * Confirm a run: freeze the forecast, and reserve what it needs so no other
 * run is shown the same stock. Stock itself doesn't change until production.
 */
export async function confirmRun(db: DB, runId: string) {
  return db.transaction(async (tx) => {
    // Serialize confirmations so two runs can't reserve the same stock at once.
    await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run) throw new OperationError("Run not found.");
    if (run.status === "confirmed") return { run, alreadyConfirmed: true };
    if (run.status !== "draft") throw new OperationError(`This run is ${run.status} and can't be confirmed.`);

    const plan = await planForRun(tx as unknown as DB, runId);
    const blockers = plan.issues.filter((i) => i.level === "blocker");
    if (blockers.length > 0) {
      throw new OperationError(`Can't confirm yet: ${blockers.map((b) => b.message).join(" ")}`);
    }

    await tx.insert(t.forecastSnapshots).values({ runId, data: JSON.parse(JSON.stringify(plan)) });
    const toReserve = plan.requirements.filter((r) => r.required !== null && r.required.gt(0));
    if (toReserve.length) {
      await tx.insert(t.reservations).values(toReserve.map((r) => ({ runId, itemId: r.itemId, quantity: r.required!.toString() })));
    }
    const [updated] = await tx
      .update(t.productionRuns)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(t.productionRuns.id, runId))
      .returning();
    await createBatchesForRun(tx, runId);
    const batches = await tx.select({ id: t.productionBatches.id, code: t.productionBatches.code }).from(t.productionBatches).where(eq(t.productionBatches.runId, runId));
    await logChange(tx, {
      action: "status",
      area: "production",
      entity: { type: "run", id: run.id, code: run.code },
      summary: `Run ${run.code} confirmed: ${batches.length} batch${batches.length === 1 ? "" : "es"} created, stock reserved`,
      changes: diff([["Status", "Draft", "Confirmed"]]),
      links: batches.map((b) => ({ type: "batch" as const, id: b.id, code: b.code })),
    });
    return { run: updated!, alreadyConfirmed: false };
  });
}

/**
 * Cancel a run (a draft is simply discarded). A confirmed run gives back its
 * reservations and its batches are marked as not made; that needs a reason.
 */
export async function cancelRun(db: DB, runId: string, reason?: string | null) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run) throw new OperationError("Run not found.");
    if (run.status === "cancelled") return;
    if (!["draft", "confirmed"].includes(run.status)) throw new OperationError(`A run that is ${run.status} can't be cancelled.`);
    const why = run.status === "draft" ? reason?.trim() || null : needReason(reason, "Say why the run is cancelled");
    const batches = await tx.select({ id: t.productionBatches.id, code: t.productionBatches.code }).from(t.productionBatches).where(eq(t.productionBatches.runId, runId));
    await tx.update(t.productionBatches).set({ status: "cancelled", closedAt: new Date() }).where(eq(t.productionBatches.runId, runId));
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.runId, runId), isNull(t.reservations.releasedAt)));
    await tx.update(t.productionRuns).set({ status: "cancelled" }).where(eq(t.productionRuns.id, runId));
    await logChange(tx, {
      action: run.status === "draft" ? "delete" : "cancel",
      area: "production",
      entity: { type: "run", id: run.id, code: run.code },
      summary: run.status === "draft" ? `Draft run ${run.code} discarded` : `Run ${run.code} cancelled: reservations released`,
      changes: diff([["Status", run.status === "draft" ? "Draft" : "Confirmed", "Cancelled"]]),
      reason: why,
      links: batches.map((b) => ({ type: "batch" as const, id: b.id, code: b.code })),
    });
  });
}

/** Bring back a discarded draft run. A cancelled confirmed run can't come back (its stock was released): plan it again. */
export async function restoreRun(db: DB, runId: string, reason?: string | null) {
  const why = needReason(reason, "Say why the run is restored");
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run) throw new OperationError("Run not found.");
    if (run.status !== "cancelled") throw new OperationError("Only a discarded run can be restored.");
    if (run.confirmedAt) throw new OperationError("This run was cancelled after it was confirmed, and its stock went to other work. Plan it again instead.");
    await tx.update(t.productionRuns).set({ status: "draft" }).where(eq(t.productionRuns.id, runId));
    await logChange(tx, {
      action: "restore",
      area: "production",
      entity: { type: "run", id: run.id, code: run.code },
      summary: `Draft run ${run.code} restored`,
      changes: diff([["Status", "Cancelled", "Draft"]]),
      reason: why,
    });
  });
}

/** Re-plan a draft run's targets. Confirmed runs are frozen. */
export async function updateDraftRun(db: DB, runId: string, plannedFor: string, targets: Record<string, number>, reason?: string | null) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run || run.status !== "draft") throw new OperationError("Only draft runs can be changed.");
    const old = await tx
      .select({ productId: t.runTargets.productId, jars: t.runTargets.targetJars, name: t.products.name })
      .from(t.runTargets)
      .innerJoin(t.products, eq(t.runTargets.productId, t.products.id))
      .where(eq(t.runTargets.runId, runId));
    await tx.update(t.productionRuns).set({ plannedFor }).where(eq(t.productionRuns.id, runId));
    await tx.delete(t.runTargets).where(eq(t.runTargets.runId, runId));
    const rows = Object.entries(targets).filter(([, n]) => n > 0);
    if (rows.length) await tx.insert(t.runTargets).values(rows.map(([productId, n]) => ({ runId, productId, targetJars: n })));
    const names = new Map(
      (rows.length ? await tx.select({ id: t.products.id, name: t.products.name }).from(t.products).where(inArray(t.products.id, rows.map(([id]) => id))) : []).map((p) => [p.id, p.name]),
    );
    for (const o of old) names.set(o.productId, o.name);
    const before = new Map(old.map((o) => [o.productId, o.jars]));
    const after = new Map(rows);
    const changes = diff([
      ["Date", run.plannedFor, plannedFor],
      ...[...names].map(([id, name]) => [name, before.has(id) ? `${before.get(id)} jars` : null, after.has(id) ? `${after.get(id)} jars` : null] as [string, unknown, unknown]),
    ]);
    if (changes.length) {
      await logChange(tx, { action: "update", area: "production", entity: { type: "run", id: run.id, code: run.code }, summary: `Draft run ${run.code} changed`, changes, reason });
    }
  });
}

