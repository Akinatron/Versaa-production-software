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
import { OperationError, today, positive, itemsById, checkWholeUnits, nextLotCode, lockNames, isDate } from "./base";

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
  const on = input.countedOn === undefined ? today() : input.countedOn;
  if (!isDate(on)) throw new OperationError("Enter the date of the count.");
  if (lines.some((l) => l.bestBefore && !isDate(l.bestBefore))) throw new OperationError("Best-before isn't a valid date.");
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
  return db.transaction(async (tx) => {
    await lockNames(tx);
    const [dup] = await tx.select().from(t.suppliers).where(sql`lower(${t.suppliers.name}) = lower(${name})`);
    if (dup) throw new OperationError(`${dup.name} already exists.`);
    const [row] = await tx.insert(t.suppliers).values({ name, contact: input.contact?.trim() || null }).returning();
    await logChange(tx, { action: "create", area: "purchasing", entity: { type: "supplier", id: row!.id, code: name }, summary: `Added supplier ${name}` });
    return row!;
  });
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
  if (!isDate(input.plannedFor)) throw new OperationError("Choose a production date.");
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

/**
 * Plan for a run. Stock and orders go to runs in the order they are made
 * (production date, then confirmation time), so an order placed for an
 * earlier run is never counted again for a later one. A draft comes after
 * every confirmed run. Once confirmed, the run is checked against what it
 * still has to use (its open reservation), not the whole recipe, so what it
 * already used isn't asked for again.
 */
export async function planForRun(db: DB, runId: string): Promise<PlanResult> {
  const [run] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
  if (!run) throw new OperationError("Run not found.");
  const [catalog, stock, targets, held] = await Promise.all([
    loadPlanCatalog(db),
    // An order that arrives after the run's date doesn't help it.
    loadStockPositions(db, { arrivingBy: run.plannedFor }),
    runTargets(db, runId),
    db
      .select({
        runId: t.reservations.runId,
        itemId: t.reservations.itemId,
        quantity: t.reservations.quantity,
        plannedFor: t.productionRuns.plannedFor,
        confirmedAt: t.productionRuns.confirmedAt,
      })
      .from(t.reservations)
      .innerJoin(t.productionRuns, eq(t.productionRuns.id, t.reservations.runId))
      .where(isNull(t.reservations.releasedAt)),
  ]);
  const confirmed = run.status !== "draft";
  const comesAfter = (r: { runId: string | null; plannedFor: string; confirmedAt: Date | null }) => {
    if (!confirmed || !run.confirmedAt) return false;
    if (r.plannedFor !== run.plannedFor) return r.plannedFor > run.plannedFor;
    const a = r.confirmedAt?.getTime() ?? Infinity;
    const b = run.confirmedAt.getTime();
    return a !== b ? a > b : (r.runId ?? "") > run.id;
  };
  // Stock positions count every reservation: give back this run's own and
  // those of runs that come after it.
  const stillToUse: Record<string, Decimal> = {};
  const notEarlier: Record<string, Decimal> = {};
  for (const r of held) {
    const mine = r.runId === runId;
    if (mine) stillToUse[r.itemId] = (stillToUse[r.itemId] ?? new Decimal(0)).plus(r.quantity);
    if (mine || comesAfter(r)) notEarlier[r.itemId] = (notEarlier[r.itemId] ?? new Decimal(0)).plus(r.quantity);
  }
  for (const [itemId, q] of Object.entries(notEarlier)) {
    const pos = stock[itemId];
    if (pos) pos.reservedEarlier = Decimal.max(0, pos.reservedEarlier.minus(q));
  }
  const plan = planProduction({ ...catalog, stock, targets, ...(confirmed ? { stillToUse } : {}) });
  // The planner only knows sizes in use; a draft that still asks for one that
  // was turned off would silently drop those jars when confirmed.
  if (!confirmed) {
    const inUse = new Set(catalog.products.map((p) => p.id));
    const off = Object.entries(targets).filter(([id, n]) => n > 0 && !inUse.has(id));
    if (off.length) {
      const names = await db.select({ id: t.products.id, name: t.products.name }).from(t.products).where(inArray(t.products.id, off.map(([id]) => id)));
      for (const n of names) {
        plan.issues.unshift({ level: "blocker", message: `${n.name} is not in use any more. Press Edit and set it to 0, or turn it back on in Settings.` });
      }
    }
  }
  return plan;
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
  if (!isDate(plannedFor)) throw new OperationError("Choose a production date.");
  for (const n of Object.values(targets)) if (!Number.isInteger(n) || n < 0) throw new OperationError("Jar targets must be whole numbers, 0 or more.");
  if (!Object.values(targets).some((n) => n > 0)) throw new OperationError("Enter at least one jar target.");
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run || run.status !== "draft") throw new OperationError("Only draft runs can be changed.");
    // The code carries the production date; keep it in step while the run is a draft.
    let code = run.code;
    if (plannedFor !== run.plannedFor) {
      const next = run.code.replace(/^RUN-\d{8}-/, `RUN-${plannedFor.replaceAll("-", "")}-`);
      const [taken] = next !== run.code ? await tx.select({ id: t.productionRuns.id }).from(t.productionRuns).where(eq(t.productionRuns.code, next)) : [];
      if (!taken) code = next;
    }
    const old = await tx
      .select({ productId: t.runTargets.productId, jars: t.runTargets.targetJars, name: t.products.name })
      .from(t.runTargets)
      .innerJoin(t.products, eq(t.runTargets.productId, t.products.id))
      .where(eq(t.runTargets.runId, runId));
    await tx.update(t.productionRuns).set({ plannedFor, code }).where(eq(t.productionRuns.id, runId));
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
      ["Production date", run.plannedFor, plannedFor],
      ["Code", run.code, code],
      ...[...names].map(([id, name]) => [name, before.has(id) ? `${before.get(id)} jars` : null, after.has(id) ? `${after.get(id)} jars` : null] as [string, unknown, unknown]),
    ]);
    if (changes.length) {
      await logChange(tx, { action: "update", area: "production", entity: { type: "run", id: run.id, code }, summary: `Draft run ${code} changed`, changes, reason: reason?.trim() || null });
    }
  });
}

