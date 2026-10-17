import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, checkWholeUnits, itemsById, today, type Tx } from "./base";
import { allocate, lotBalance } from "./ledger";
import { convert, type UnitCode } from "@/domain/quantity";
import { batchPrefixFor } from "@/domain/codes";
import type { PlanResult } from "@/domain/planner";

/*
 * Recording production and packaging.
 *
 * - A confirmed run gets one batch per planned batch, each pinned to the
 *   recipe version it follows. Later recipe changes never touch it.
 * - Each recipe line of a batch starts as "pending". Recording it (even as 0)
 *   confirms it and takes the quantity from specific lots.
 * - Measured output becomes a bulk-sauce lot. Packaging takes litres from it,
 *   packaging materials for every filled jar (rejects used materials too),
 *   and adds only accepted jars to a finished lot for this batch and size.
 * - As stock is used, the run's reservations shrink by the same amount.
 */

const D0 = new Decimal(0);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function getBatch(tx: Tx, batchId: string) {
  const [row] = await tx
    .select({ batch: t.productionBatches, run: t.productionRuns, sauce: t.sauces })
    .from(t.productionBatches)
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .where(eq(t.productionBatches.id, batchId));
  if (!row) throw new OperationError("Batch not found.");
  return row;
}

function assertOpen(batch: typeof t.productionBatches.$inferSelect) {
  if (batch.status === "closed") throw new OperationError(`${batch.code} is closed. Record a stock correction instead.`);
  if (batch.status === "cancelled") throw new OperationError(`${batch.code} is cancelled.`);
}

async function markStarted(tx: Tx, batch: typeof t.productionBatches.$inferSelect, next: (typeof t.batchStatus.enumValues)[number]) {
  const order = t.batchStatus.enumValues;
  if (order.indexOf(next) > order.indexOf(batch.status)) {
    await tx.update(t.productionBatches).set({ status: next }).where(eq(t.productionBatches.id, batch.id));
  }
  await tx
    .update(t.productionRuns)
    .set({ status: "in_progress" })
    .where(and(eq(t.productionRuns.id, batch.runId), eq(t.productionRuns.status, "confirmed")));
}

// ---------------------------------------------------------------- batches

/**
 * Create the batches a confirmed run planned, from its saved forecast.
 * Safe to call again: a run that already has batches is left alone.
 */
export async function createBatchesForRun(tx: Tx, runId: string) {
  const existing = await tx.select({ id: t.productionBatches.id }).from(t.productionBatches).where(eq(t.productionBatches.runId, runId));
  if (existing.length > 0) return { created: 0 };
  const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
  if (!run || !["confirmed", "in_progress"].includes(run.status)) throw new OperationError("Only confirmed runs have batches.");
  const [snap] = await tx.select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, runId));
  if (!snap) throw new OperationError("This run has no saved forecast.");
  const plan = snap.data as unknown as PlanResult;

  let created = 0;
  for (const s of plan.sauces) {
    if (!s.batches) continue;
    const [sauce] = await tx.select().from(t.sauces).where(eq(t.sauces.id, s.sauceId));
    const [version] = await tx
      .select()
      .from(t.recipeVersions)
      .where(and(eq(t.recipeVersions.sauceId, s.sauceId), eq(t.recipeVersions.versionNo, s.recipeVersionNo ?? -1)));
    if (!sauce || !version) throw new OperationError(`${s.name}: the recipe version in the forecast was not found.`);
    const lines = await tx.select().from(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, version.id));
    const items = await itemsById(tx, lines.map((l) => l.itemId));

    const prefix = `${sauce.batchPrefix ?? batchPrefixFor(sauce.name)}-${run.plannedFor.replaceAll("-", "")}`;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t.productionBatches)
      .where(sql`${t.productionBatches.code} like ${prefix + "-%"}`);

    for (let i = 1; i <= s.batches; i++) {
      const [batch] = await tx
        .insert(t.productionBatches)
        .values({ code: `${prefix}-${String(n + i).padStart(2, "0")}`, runId, sauceId: sauce.id, recipeVersionId: version.id, seq: i })
        .returning();
      if (lines.length) {
        await tx.insert(t.batchConsumption).values(
          lines.map((l) => {
            const item = items.get(l.itemId)!;
            const std = convert(l.quantity, l.unit as UnitCode, item.stockUnit as UnitCode).toString();
            // The run plans exactly one recipe's worth per batch.
            return { batchId: batch!.id, itemId: l.itemId, standardQty: std, plannedQty: std };
          }),
        );
      }
      created++;
    }
  }
  return { created };
}

export async function ensureBatches(db: DB, runId: string) {
  return db.transaction((tx) => createBatchesForRun(tx, runId));
}

/**
 * Bring a run's reservation of an item in line with what its batches have
 * used so far: reserved = originally reserved − used (never below 0).
 */
async function syncRunReservation(tx: Tx, runId: string, itemId: string) {
  const [row] = await tx.execute<{ original: string | null; current: string | null; used: string | null }>(sql`
    select
      (select sum(quantity) from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null and quantity > 0) as original,
      (select sum(quantity) from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null) as current,
      (select -sum(m.quantity) from movements m
         where m.item_id = ${itemId} and (
           (m.doc_type = 'batch_consumption' and m.doc_id in (
              select c.id from batch_consumption c join production_batches b on b.id = c.batch_id where b.run_id = ${runId}))
           or (m.doc_type = 'packaging_session' and m.doc_id in (
              select s.id from packaging_sessions s join production_batches b on b.id = s.batch_id where b.run_id = ${runId}))
         )) as used`);
  const original = new Decimal(row?.original ?? 0);
  if (original.isZero()) return;
  const target = Decimal.max(D0, original.minus(row?.used ?? 0));
  const diff = target.minus(row?.current ?? 0);
  if (!diff.isZero()) await tx.insert(t.reservations).values({ runId, itemId, quantity: diff.toString() });
}

// ---------------------------------------------------------------- ingredients used

export interface ConsumptionInput {
  idempotencyKey: string;
  batchId: string;
  itemId: string;
  /** Total used, in the item's stock unit. 0 is a confirmed zero. */
  quantity: Decimal.Value;
  /** Optional: which lots it came from. Otherwise earliest best-before first. */
  lots?: { lotId: string; quantity: Decimal.Value }[];
  occurredOn?: string;
}

/** Record how much of one ingredient a batch actually used, and from which lots. */
export async function recordConsumption(db: DB, input: ConsumptionInput) {
  return db.transaction(async (tx) => {
    const { batch } = await getBatch(tx, input.batchId);
    let [line] = await tx
      .select()
      .from(t.batchConsumption)
      .where(and(eq(t.batchConsumption.batchId, batch.id), eq(t.batchConsumption.itemId, input.itemId)));
    if (line?.recordKey === input.idempotencyKey) return { alreadyRecorded: true };
    assertOpen(batch);

    const item = (await itemsById(tx, [input.itemId])).get(input.itemId);
    if (!item || item.kind !== "ingredient") throw new OperationError("Choose an ingredient.");
    if (line?.confirmedAt) throw new OperationError(`${item.name} is already recorded for ${batch.code}. Undo it first to record it again.`);

    let qty: Decimal;
    try {
      qty = new Decimal(input.quantity);
    } catch {
      throw new OperationError(`${item.name}: "${input.quantity}" is not a number.`);
    }
    if (qty.isNaN() || qty.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
    checkWholeUnits(item, qty);
    const chosen = input.lots?.filter((l) => String(l.quantity).trim() !== "" && !new Decimal(l.quantity).isZero());
    if (chosen && chosen.length > 0) {
      const sum = chosen.reduce((s, l) => s.plus(l.quantity), D0);
      if (!sum.eq(qty)) throw new OperationError(`${item.name}: the lots add up to ${sum}, not ${qty}.`);
    }

    if (!line) {
      // An ingredient not in the recipe: recorded as an extra.
      [line] = await tx.insert(t.batchConsumption).values({ batchId: batch.id, itemId: item.id, standardQty: "0", plannedQty: "0", extra: true }).returning();
    }

    const allocations = await allocate(tx, item, qty, chosen);
    const on = input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today();
    let i = 0;
    for (const a of allocations) {
      await tx.insert(t.movements).values({
        lotId: a.lotId,
        itemId: item.id,
        quantity: a.quantity.neg().toString(),
        type: "consumption",
        occurredAt: new Date(`${on}T12:00:00Z`),
        docType: "batch_consumption",
        docId: line!.id,
        reason: `Used in ${batch.code}`,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }
    // A confirmed zero has no movements; confirmedAt is what tells it apart from pending.
    await tx.update(t.batchConsumption).set({ confirmedAt: new Date(), recordKey: input.idempotencyKey }).where(eq(t.batchConsumption.id, line!.id));
    await markStarted(tx, batch, "in_production");
    await syncRunReservation(tx, batch.runId, item.id);
    return { alreadyRecorded: false };
  });
}

/** Undo a recorded ingredient line: puts the stock back with reversal movements and makes it pending again. */
export async function undoConsumption(db: DB, input: { idempotencyKey: string; batchId: string; itemId: string; reason: string }) {
  if (!input.reason.trim()) throw new OperationError("Say why it's being undone.");
  return db.transaction(async (tx) => {
    const done = await tx.select({ id: t.movements.id }).from(t.movements).where(sql`${t.movements.idempotencyKey} like ${input.idempotencyKey + ":%"}`);
    if (done.length > 0) return { alreadyRecorded: true };
    const { batch } = await getBatch(tx, input.batchId);
    assertOpen(batch);
    const [line] = await tx
      .select()
      .from(t.batchConsumption)
      .where(and(eq(t.batchConsumption.batchId, batch.id), eq(t.batchConsumption.itemId, input.itemId)));
    if (!line?.confirmedAt) throw new OperationError("Nothing recorded to undo.");
    const moves = await tx
      .select()
      .from(t.movements)
      .where(and(eq(t.movements.docType, "batch_consumption"), eq(t.movements.docId, line.id), sql`${t.movements.reversesMovementId} is null`));
    const reversed = await tx
      .select({ id: t.movements.reversesMovementId })
      .from(t.movements)
      .where(and(eq(t.movements.docType, "batch_consumption"), eq(t.movements.docId, line.id), sql`${t.movements.reversesMovementId} is not null`));
    const reversedIds = new Set(reversed.map((r) => r.id));
    let i = 0;
    for (const m of moves) {
      if (reversedIds.has(m.id)) continue;
      await tx.insert(t.movements).values({
        lotId: m.lotId,
        itemId: m.itemId,
        quantity: new Decimal(m.quantity).neg().toString(),
        type: "reversal",
        occurredAt: new Date(),
        docType: "batch_consumption",
        docId: line.id,
        reason: input.reason.trim(),
        reversesMovementId: m.id,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }
    await tx.update(t.batchConsumption).set({ confirmedAt: null, recordKey: null }).where(eq(t.batchConsumption.id, line.id));
    await syncRunReservation(tx, batch.runId, input.itemId);
    return { alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- output

/**
 * Record what the batch produced, as measured. Litres become a bulk lot that
 * packaging draws from; kg is kept for reference. Either can be left unknown.
 * Recording again corrects the figure with a new movement (history is kept).
 */
export async function recordBatchOutput(
  db: DB,
  input: { idempotencyKey: string; batchId: string; producedOn: string; litres?: string | null; kg?: string | null; note?: string | null },
) {
  const litres = input.litres?.trim() ? new Decimal(input.litres) : null;
  const kg = input.kg?.trim() ? new Decimal(input.kg) : null;
  if (!litres && !kg) throw new OperationError("Enter the measured litres, kilograms, or both.");
  if ((litres && (litres.isNaN() || litres.lt(0))) || (kg && (kg.isNaN() || kg.lt(0)))) throw new OperationError("Output can't be negative.");
  if (!isDate(input.producedOn)) throw new OperationError("Enter the production date.");

  return db.transaction(async (tx) => {
    const done = await tx.select({ id: t.movements.id }).from(t.movements).where(eq(t.movements.idempotencyKey, input.idempotencyKey));
    if (done.length > 0) return { alreadyRecorded: true };
    const { batch, sauce } = await getBatch(tx, input.batchId);
    assertOpen(batch);

    let bulkLotId = batch.bulkLotId;
    if (litres) {
      const bulkItemId = await ensureBulkItem(tx, sauce);
      if (!bulkLotId) {
        const [lot] = await tx
          .insert(t.lots)
          .values({ itemId: bulkItemId, code: `${batch.code}-BULK`, receivedOn: input.producedOn, batchId: batch.id })
          .returning();
        bulkLotId = lot!.id;
      }
      // Bring the bulk lot to: measured litres − litres already packed.
      const packed = await tx.execute<{ l: string | null }>(sql`
        select sum(l.filled * l.fill_ml) / 1000.0 as l from packaging_session_lines l
        join packaging_sessions s on s.id = l.session_id where s.batch_id = ${batch.id}`);
      const already = new Decimal([...packed][0]?.l ?? 0);
      if (litres.lt(already)) throw new OperationError(`${already} L has already been packed from this batch, so the output can't be less than that.`);
      const balance = await lotBalance(tx, bulkLotId);
      const diff = litres.minus(already).minus(balance);
      const first = batch.outputLitres === null;
      await tx.insert(t.movements).values({
        lotId: bulkLotId,
        itemId: bulkItemId,
        quantity: diff.toString(),
        type: first ? "production_output" : "count_correction",
        occurredAt: new Date(`${input.producedOn}T12:00:00Z`),
        docType: "batch",
        docId: batch.id,
        reason: first ? `Produced in ${batch.code}` : `Measured output corrected to ${litres} L`,
        idempotencyKey: input.idempotencyKey,
      });
    }
    await tx
      .update(t.productionBatches)
      .set({
        producedOn: input.producedOn,
        outputLitres: litres ? litres.toString() : batch.outputLitres,
        outputKg: kg ? kg.toString() : batch.outputKg,
        bulkLotId,
        note: input.note?.trim() || batch.note,
      })
      .where(eq(t.productionBatches.id, batch.id));
    await markStarted(tx, batch, "awaiting_packaging");
    return { alreadyRecorded: false };
  });
}

export async function ensureBulkItem(tx: Tx, sauce: { code: string; name: string }) {
  const code = `bulk-${sauce.code}`;
  await tx.insert(t.items).values({ code, name: `${sauce.name} (bulk, awaiting packaging)`, kind: "bulk", stockUnit: "L" }).onConflictDoNothing({ target: t.items.code });
  const [row] = await tx.select({ id: t.items.id }).from(t.items).where(eq(t.items.code, code));
  return row!.id;
}

// ---------------------------------------------------------------- packaging

export interface PackagingLineInput {
  productId: string;
  filled: number;
  rejected: number;
}

/**
 * Record a packaging session for a batch. For each size: jars filled and
 * rejected (accepted = filled − rejected). Materials are used for every filled
 * jar; only accepted jars enter stock, in a lot for this batch and size.
 */
export async function recordPackaging(
  db: DB,
  input: { idempotencyKey: string; batchId: string; packedOn: string; bestBefore?: string | null; note?: string | null; lines: PackagingLineInput[] },
) {
  if (!isDate(input.packedOn)) throw new OperationError("Enter the packaging date.");
  const lines = input.lines.filter((l) => l.filled > 0 || l.rejected > 0);
  if (lines.length === 0) throw new OperationError("Enter the jars filled for at least one size.");
  for (const l of lines) {
    if (!Number.isInteger(l.filled) || !Number.isInteger(l.rejected) || l.filled < 0 || l.rejected < 0)
      throw new OperationError("Jars must be whole numbers, 0 or more.");
    if (l.rejected > l.filled) throw new OperationError("Rejected jars can't be more than jars filled.");
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.packagingSessions).where(eq(t.packagingSessions.idempotencyKey, input.idempotencyKey));
    if (existing) return { session: existing, alreadyRecorded: true };
    const { batch, sauce } = await getBatch(tx, input.batchId);
    assertOpen(batch);

    const productRows = await tx
      .select({ product: t.products, format: t.formats })
      .from(t.products)
      .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
      .where(inArray(t.products.id, lines.map((l) => l.productId)));
    const versions = await tx
      .select()
      .from(t.packagingVersions)
      .where(and(inArray(t.packagingVersions.productId, lines.map((l) => l.productId)), eq(t.packagingVersions.status, "active")));
    const pkgLines = versions.length
      ? await tx.select().from(t.packagingLines).where(inArray(t.packagingLines.packagingVersionId, versions.map((v) => v.id)))
      : [];

    // Materials for every filled jar, summed per item.
    const need = new Map<string, Decimal>();
    let litres = D0;
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId);
      if (!p || p.product.sauceId !== sauce.id) throw new OperationError(`That product isn't ${sauce.name}.`);
      const v = versions.find((x) => x.productId === l.productId);
      if (!v) throw new OperationError(`${p.product.name}: no packaging list is set up.`);
      for (const pl of pkgLines.filter((x) => x.packagingVersionId === v.id)) {
        need.set(pl.itemId, (need.get(pl.itemId) ?? D0).plus(l.filled * pl.perJar));
      }
      litres = litres.plus(new Decimal(l.filled).mul(p.format.fillMl).div(1000));
    }

    const [session] = await tx
      .insert(t.packagingSessions)
      .values({ batchId: batch.id, packedOn: input.packedOn, idempotencyKey: input.idempotencyKey, note: input.note?.trim() || null })
      .returning();
    const at = new Date(`${input.packedOn}T12:00:00Z`);
    let i = 0;
    const move = (lotId: string, itemId: string, qty: Decimal, type: "consumption" | "packaging_output", reason: string) =>
      tx.insert(t.movements).values({
        lotId,
        itemId,
        quantity: qty.toString(),
        type,
        occurredAt: at,
        docType: "packaging_session",
        docId: session!.id,
        reason,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });

    // Packaging materials.
    const items = await itemsById(tx, [...need.keys()]);
    const shortages: string[] = [];
    const plans: { itemId: string; allocations: Awaited<ReturnType<typeof allocate>> }[] = [];
    for (const [itemId, qty] of need) {
      if (qty.isZero()) continue;
      try {
        plans.push({ itemId, allocations: await allocate(tx, items.get(itemId)!, qty) });
      } catch (e) {
        if (e instanceof OperationError) shortages.push(e.message);
        else throw e;
      }
    }
    if (shortages.length) throw new OperationError(shortages.join(" "));
    for (const p of plans) for (const a of p.allocations) await move(a.lotId, p.itemId, a.quantity.neg(), "consumption", `Packed ${batch.code}`);

    // Bulk sauce, when its output was measured in litres.
    if (batch.bulkLotId) {
      const balance = await lotBalance(tx, batch.bulkLotId);
      if (balance.lt(litres)) {
        throw new OperationError(
          `These jars hold ${litres} L but only ${balance} L of ${batch.code} is left. Correct the measured output first if it was more.`,
        );
      }
      const [bulk] = await tx.select().from(t.lots).where(eq(t.lots.id, batch.bulkLotId));
      await move(batch.bulkLotId, bulk!.itemId, litres.neg(), "consumption", `Filled into jars`);
    }

    // Accepted jars into a finished lot per batch and size.
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId)!;
      const v = versions.find((x) => x.productId === l.productId)!;
      const accepted = l.filled - l.rejected;
      let [lot] = await tx.select().from(t.lots).where(and(eq(t.lots.batchId, batch.id), eq(t.lots.itemId, p.product.itemId)));
      if (!lot) {
        [lot] = await tx
          .insert(t.lots)
          .values({
            itemId: p.product.itemId,
            code: `${batch.code}-${p.format.capacityMl}`,
            batchId: batch.id,
            receivedOn: input.packedOn,
            bestBefore: input.bestBefore || null,
          })
          .returning();
      } else if (!lot.bestBefore && input.bestBefore) {
        await tx.update(t.lots).set({ bestBefore: input.bestBefore }).where(eq(t.lots.id, lot.id));
      }
      if (accepted > 0) await move(lot!.id, p.product.itemId, new Decimal(accepted), "packaging_output", `Packed from ${batch.code}`);
      await tx.insert(t.packagingSessionLines).values({
        sessionId: session!.id,
        productId: p.product.id,
        packagingVersionId: v.id,
        fillMl: p.format.fillMl,
        filled: l.filled,
        rejected: l.rejected,
        accepted,
        finishedLotId: lot!.id,
      });
    }

    await markStarted(tx, batch, "packing");
    for (const itemId of need.keys()) await syncRunReservation(tx, batch.runId, itemId);
    return { session: session!, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- incidents and closing

export async function recordIncident(
  db: DB,
  input: { batchId?: string | null; lotId?: string | null; type: (typeof t.incidentType.enumValues)[number]; note: string; occurredOn?: string },
) {
  if (!input.note.trim()) throw new OperationError("Describe what happened.");
  if (!input.batchId && !input.lotId) throw new OperationError("Link the incident to a batch or a lot.");
  const [row] = await db
    .insert(t.incidents)
    .values({ batchId: input.batchId || null, lotId: input.lotId || null, type: input.type, note: input.note.trim(), occurredOn: input.occurredOn || today() })
    .returning();
  return row!;
}

/**
 * Close a batch. Every ingredient line must be recorded first (a pending
 * line is not the same as zero). Bulk sauce left over is written off with a
 * reason. When every batch of the run is closed, the run closes and any
 * stock still reserved for it is released.
 */
export async function closeBatch(db: DB, input: { idempotencyKey: string; batchId: string; leftoverReason?: string | null; notMade?: boolean }) {
  return db.transaction(async (tx) => {
    const { batch } = await getBatch(tx, input.batchId);
    if (batch.status === "closed") return { alreadyClosed: true };
    assertOpen(batch);

    if (input.notMade) {
      const sessions = await tx.select({ id: t.packagingSessions.id }).from(t.packagingSessions).where(eq(t.packagingSessions.batchId, batch.id));
      const used = await tx
        .select({ id: t.batchConsumption.id })
        .from(t.batchConsumption)
        .where(and(eq(t.batchConsumption.batchId, batch.id), sql`${t.batchConsumption.confirmedAt} is not null`));
      if (sessions.length || used.length || batch.bulkLotId) throw new OperationError("Something is already recorded for this batch, so it can't be marked as not made.");
      await tx
        .update(t.productionBatches)
        .set({ status: "cancelled", closedAt: new Date(), note: input.leftoverReason?.trim() || batch.note })
        .where(eq(t.productionBatches.id, batch.id));
    } else {
      const pending = await tx
        .select({ name: t.items.name })
        .from(t.batchConsumption)
        .innerJoin(t.items, eq(t.batchConsumption.itemId, t.items.id))
        .where(and(eq(t.batchConsumption.batchId, batch.id), isNull(t.batchConsumption.confirmedAt)));
      if (pending.length) throw new OperationError(`Still pending: ${pending.map((p) => p.name).join(", ")}. Record what was used (0 if none) before closing.`);
      if (batch.bulkLotId) {
        const left = await lotBalance(tx, batch.bulkLotId);
        if (left.gt(0)) {
          if (!input.leftoverReason?.trim()) throw new OperationError(`${left} L of bulk sauce is left. Say what happened to it before closing.`);
          const [bulk] = await tx.select().from(t.lots).where(eq(t.lots.id, batch.bulkLotId));
          await tx.insert(t.movements).values({
            lotId: batch.bulkLotId,
            itemId: bulk!.itemId,
            quantity: left.neg().toString(),
            type: "waste",
            occurredAt: new Date(),
            docType: "batch",
            docId: batch.id,
            reason: input.leftoverReason.trim(),
            idempotencyKey: input.idempotencyKey,
          });
        }
      }
      await tx.update(t.productionBatches).set({ status: "closed", closedAt: new Date() }).where(eq(t.productionBatches.id, batch.id));
    }

    const open = await tx
      .select({ id: t.productionBatches.id })
      .from(t.productionBatches)
      .where(and(eq(t.productionBatches.runId, batch.runId), sql`${t.productionBatches.status} not in ('closed', 'cancelled')`));
    if (open.length === 0) {
      await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.runId, batch.runId), isNull(t.reservations.releasedAt)));
      await tx.update(t.productionRuns).set({ status: "closed" }).where(eq(t.productionRuns.id, batch.runId));
    }
    return { alreadyClosed: false, runClosed: open.length === 0 };
  });
}
