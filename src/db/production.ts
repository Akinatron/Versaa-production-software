import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, checkWholeUnits, itemsById, today, type Tx } from "./base";
import { lotBalance } from "./ledger";
import { applySplit, autoSplit, checkManualSplit, lotsOf, sameSplit, splitTotal, usedByDocs, type LotSplit } from "./lot-use";
import { convert, type UnitCode } from "@/domain/quantity";
import { batchPrefixFor } from "@/domain/codes";
import type { PlanResult } from "@/domain/planner";

/*
 * Recording production and packaging.
 *
 * - A confirmed run gets one batch per planned batch, each pinned to the
 *   recipe version it follows. Later recipe changes never touch it.
 * - Each recipe line of a batch starts as "pending". Recording it (even as 0)
 *   confirms it and takes the quantity from specific lots. Recording again
 *   corrects it by the difference.
 * - A batch's litres are always the jars filled × fill per jar (rejects
 *   included). There is no bulk sauce stock.
 * - Packaging uses materials for every filled jar (rejects used materials
 *   too) and adds only accepted jars to a finished lot for this batch and size.
 *   Sessions can be edited or deleted; stock moves by the difference.
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
      (select coalesce(sum(quantity), 0) from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null and quantity > 0)
        - (select coalesce(sum(c.planned_qty), 0) from batch_consumption c join production_batches b on b.id = c.batch_id
           where b.run_id = ${runId} and b.status = 'cancelled' and c.item_id = ${itemId}) as original,
      (select sum(quantity) from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null) as current,
      (select -sum(m.quantity) from movements m
         where m.item_id = ${itemId} and (
           (m.doc_type = 'batch_consumption' and m.doc_id in (
              select c.id from batch_consumption c join production_batches b on b.id = c.batch_id where b.run_id = ${runId}))
           or (m.doc_type = 'packaging_session' and m.doc_id in (
              select s.id from packaging_sessions s join production_batches b on b.id = s.batch_id where b.run_id = ${runId}))
         )) as used`);
  const original = Decimal.max(D0, new Decimal(row?.original ?? 0));
  if (original.isZero() && new Decimal(row?.current ?? 0).isZero()) return;
  const target = Decimal.max(D0, original.minus(row?.used ?? 0));
  const diff = target.minus(row?.current ?? 0);
  if (!diff.isZero()) await tx.insert(t.reservations).values({ runId, itemId, quantity: diff.toString() });
}

// ---------------------------------------------------------------- ingredients used

export interface IngredientLineInput {
  itemId: string;
  /** Total used, in the item's stock unit. 0 is a confirmed zero. */
  quantity: Decimal.Value;
  /** Manual mode: how much came from each lot. Otherwise automatic (earliest best-before first). */
  lots?: { lotId: string; quantity: Decimal.Value }[];
}

function parseQty(name: string, v: Decimal.Value): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(String(v).trim() === "" ? NaN : v);
  } catch {
    throw new OperationError(`${name}: "${v}" is not a number.`);
  }
  if (d.isNaN()) throw new OperationError(`${name}: enter the quantity used (0 if none was used).`);
  if (d.lt(0)) throw new OperationError(`${name}: quantity can't be negative.`);
  return d;
}

/** Move the batch forward to `next` if it isn't there yet (never backwards). */
async function advance(tx: Tx, batchId: string, next: (typeof t.batchStatus.enumValues)[number]) {
  const [b] = await tx.select().from(t.productionBatches).where(eq(t.productionBatches.id, batchId));
  if (b) await markStarted(tx, b, next);
}

/**
 * Record the ingredients a batch used, all lines at once ("Record").
 *
 * - A pending line is taken from stock for the first time.
 * - A line already recorded is corrected: only the difference moves
 *   (2 kg recorded but it was 3 → 1 kg more from the same lot).
 * - In manual mode the quantity per lot is given and the split is matched.
 * - A line not in the recipe is added as an extra.
 * When no line is left pending the batch is cooked and waits for packaging.
 */
export async function recordIngredients(db: DB, input: { idempotencyKey: string; batchId: string; producedOn?: string | null; lines: IngredientLineInput[] }) {
  if (input.producedOn && !isDate(input.producedOn)) throw new OperationError("Enter the production date.");
  return db.transaction(async (tx) => {
    const { batch } = await getBatch(tx, input.batchId);
    const existing = await tx.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
    if (existing.some((l) => l.recordKey === input.idempotencyKey)) return { alreadyRecorded: true, changed: 0 };
    assertOpen(batch);

    const seen = new Set<string>();
    for (const l of input.lines) {
      if (seen.has(l.itemId)) throw new OperationError("The same ingredient is listed twice.");
      seen.add(l.itemId);
    }
    const items = await itemsById(tx, input.lines.map((l) => l.itemId));
    const byItem = new Map(existing.map((l) => [l.itemId, l]));
    const used = await usedByDocs(tx, "batch_consumption", existing.map((l) => l.id));
    const lots = await lotsOf(tx, input.lines.map((l) => l.itemId));

    const errors: string[] = [];
    const plans: { item: typeof t.items.$inferSelect; line?: typeof t.batchConsumption.$inferSelect; current: LotSplit; target: LotSplit; qty: Decimal }[] = [];
    for (const l of input.lines) {
      const item = items.get(l.itemId);
      try {
        if (!item || item.kind !== "ingredient") throw new OperationError("Choose an ingredient.");
        const line = byItem.get(item.id);
        const current = line ? (used.get(line.id)?.get(item.id) ?? new Map<string, Decimal>()) : new Map<string, Decimal>();
        const itemLots = lots.filter((x) => x.itemId === item.id);
        const chosen = l.lots?.filter((x) => String(x.quantity).trim() !== "");
        let qty: Decimal;
        let target: LotSplit;
        if (chosen && chosen.length > 0) {
          target = new Map();
          for (const c of chosen) {
            if (!c.lotId) throw new OperationError(`${item.name}: choose the lot for each quantity.`);
            const q = parseQty(item.name, c.quantity);
            if (target.has(c.lotId)) throw new OperationError(`${item.name}: the same lot is chosen twice.`);
            if (!q.isZero()) target.set(c.lotId, q);
          }
          qty = splitTotal(target);
          if (String(l.quantity).trim() !== "" && !parseQty(item.name, l.quantity).eq(qty)) {
            throw new OperationError(`${item.name}: the lots add up to ${qty}, not ${l.quantity}.`);
          }
          checkManualSplit(item, current, target, itemLots);
        } else {
          qty = parseQty(item.name, l.quantity);
          target = autoSplit(item, current, itemLots, qty);
        }
        checkWholeUnits(item, qty);
        plans.push({ item, line, current, target, qty });
      } catch (e) {
        if (e instanceof OperationError) errors.push(e.message);
        else throw e;
      }
    }
    if (errors.length) throw new OperationError(errors.join(" "));

    const on = input.producedOn || batch.producedOn || today();
    const at = new Date(`${on}T12:00:00Z`);
    let changed = 0;
    for (const p of plans) {
      let line = p.line;
      if (!line) {
        [line] = await tx.insert(t.batchConsumption).values({ batchId: batch.id, itemId: p.item.id, standardQty: "0", plannedQty: "0", extra: true }).returning();
      }
      const first = !line!.confirmedAt;
      const before = splitTotal(p.current);
      const posted = await applySplit(tx, {
        itemId: p.item.id,
        docType: "batch_consumption",
        docId: line!.id,
        current: p.current,
        target: p.target,
        at,
        takeReason: first ? `Used in ${batch.code}` : `Corrected in ${batch.code}: ${before} → ${p.qty} ${p.item.stockUnit}`,
        giveReason: `Corrected in ${batch.code}: ${before} → ${p.qty} ${p.item.stockUnit}`,
        keyPrefix: `${input.idempotencyKey}:${p.item.id}`,
      });
      if (posted || first) changed++;
      // A confirmed zero has no movements; confirmedAt is what tells it apart from pending.
      await tx
        .update(t.batchConsumption)
        .set({ confirmedAt: line!.confirmedAt ?? new Date(), recordKey: input.idempotencyKey })
        .where(eq(t.batchConsumption.id, line!.id));
      await syncRunReservation(tx, batch.runId, p.item.id);
    }
    if (input.producedOn && input.producedOn !== batch.producedOn) {
      await tx.update(t.productionBatches).set({ producedOn: input.producedOn }).where(eq(t.productionBatches.id, batch.id));
    }
    await markStarted(tx, batch, "in_production");
    const [{ pending } = { pending: 0 }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(t.batchConsumption)
      .where(and(eq(t.batchConsumption.batchId, batch.id), isNull(t.batchConsumption.confirmedAt)));
    if (pending === 0) await advance(tx, batch.id, "awaiting_packaging");
    return { alreadyRecorded: false, changed };
  });
}

/** Record (or correct) one ingredient line. Same rules as `recordIngredients`. */
export async function recordConsumption(
  db: DB,
  input: { idempotencyKey: string; batchId: string; itemId: string; quantity: Decimal.Value; lots?: { lotId: string; quantity: Decimal.Value }[]; occurredOn?: string },
) {
  return recordIngredients(db, {
    idempotencyKey: input.idempotencyKey,
    batchId: input.batchId,
    producedOn: input.occurredOn,
    lines: [{ itemId: input.itemId, quantity: input.quantity, lots: input.lots }],
  });
}

// ---------------------------------------------------------------- packaging

export interface PackagingLineInput {
  productId: string;
  filled: number;
  rejected: number;
}

function checkJarNumbers(lines: PackagingLineInput[]) {
  for (const l of lines) {
    if (!Number.isInteger(l.filled) || !Number.isInteger(l.rejected) || l.filled < 0 || l.rejected < 0)
      throw new OperationError("Jars must be whole numbers, 0 or more.");
    if (l.rejected > l.filled) throw new OperationError("Rejected jars can't be more than jars filled.");
  }
}

/**
 * Products, packaging list versions and materials needed for these jars.
 * Lines already recorded keep the packaging version they used; new sizes use
 * the active one. Materials are used for every filled jar, rejects included.
 */
async function packagingNeeds(tx: Tx, sauce: { id: string; name: string }, lines: (PackagingLineInput & { packagingVersionId?: string | null })[]) {
  const productIds = lines.map((l) => l.productId);
  const productRows = productIds.length
    ? await tx.select({ product: t.products, format: t.formats }).from(t.products).innerJoin(t.formats, eq(t.products.formatId, t.formats.id)).where(inArray(t.products.id, productIds))
    : [];
  const active = productIds.length
    ? await tx.select().from(t.packagingVersions).where(and(inArray(t.packagingVersions.productId, productIds), eq(t.packagingVersions.status, "active")))
    : [];
  const versionOf = new Map<string, string>();
  for (const l of lines) {
    const p = productRows.find((r) => r.product.id === l.productId);
    if (!p || p.product.sauceId !== sauce.id) throw new OperationError(`That product isn't ${sauce.name}.`);
    const v = l.packagingVersionId ?? active.find((x) => x.productId === l.productId)?.id;
    if (!v) throw new OperationError(`${p.product.name}: no packaging list is set up.`);
    versionOf.set(l.productId, v);
  }
  const versionIds = [...new Set(versionOf.values())];
  const pkgLines = versionIds.length ? await tx.select().from(t.packagingLines).where(inArray(t.packagingLines.packagingVersionId, versionIds)) : [];
  const need = new Map<string, Decimal>();
  for (const l of lines) {
    for (const pl of pkgLines.filter((x) => x.packagingVersionId === versionOf.get(l.productId))) {
      need.set(pl.itemId, (need.get(pl.itemId) ?? D0).plus(l.filled * pl.perJar));
    }
  }
  return { productRows, versionOf, need };
}

/** Plan the material movements for a session going from `used` to `need`. Collects every shortage. */
async function planMaterials(tx: Tx, need: Map<string, Decimal>, used: Map<string, LotSplit>) {
  const itemIds = [...new Set([...need.keys(), ...used.keys()])];
  const items = await itemsById(tx, itemIds);
  const lots = await lotsOf(tx, itemIds);
  const errors: string[] = [];
  const plans: { itemId: string; current: LotSplit; target: LotSplit }[] = [];
  for (const itemId of itemIds) {
    const current = used.get(itemId) ?? new Map<string, Decimal>();
    try {
      const target = autoSplit(items.get(itemId)!, current, lots.filter((l) => l.itemId === itemId), need.get(itemId) ?? D0);
      if (!sameSplit(current, target)) plans.push({ itemId, current, target });
    } catch (e) {
      if (e instanceof OperationError) errors.push(e.message);
      else throw e;
    }
  }
  return { plans, errors };
}

/** The finished lot for this batch and size (one per batch and size), created if needed. */
async function finishedLot(tx: Tx, batch: { id: string; code: string }, p: { product: typeof t.products.$inferSelect; format: typeof t.formats.$inferSelect }, on: string, bestBefore: string | null) {
  let [lot] = await tx.select().from(t.lots).where(and(eq(t.lots.batchId, batch.id), eq(t.lots.itemId, p.product.itemId)));
  if (!lot) {
    [lot] = await tx
      .insert(t.lots)
      .values({ itemId: p.product.itemId, code: `${batch.code}-${p.format.capacityMl}`, batchId: batch.id, receivedOn: on, bestBefore })
      .returning();
  } else if (!lot.bestBefore && bestBefore) {
    await tx.update(t.lots).set({ bestBefore }).where(eq(t.lots.id, lot.id));
  }
  return lot!;
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
  if (input.bestBefore && !isDate(input.bestBefore)) throw new OperationError("Best-before isn't a valid date.");
  const lines = input.lines.filter((l) => l.filled > 0 || l.rejected > 0);
  if (lines.length === 0) throw new OperationError("Enter the jars filled for at least one size.");
  checkJarNumbers(lines);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.packagingSessions).where(eq(t.packagingSessions.idempotencyKey, input.idempotencyKey));
    if (existing) return { session: existing, alreadyRecorded: true };
    const { batch, sauce } = await getBatch(tx, input.batchId);
    assertOpen(batch);

    const { productRows, versionOf, need } = await packagingNeeds(tx, sauce, lines);
    const { plans, errors } = await planMaterials(tx, need, new Map());
    if (errors.length) throw new OperationError(errors.join(" "));

    const [session] = await tx
      .insert(t.packagingSessions)
      .values({ batchId: batch.id, packedOn: input.packedOn, idempotencyKey: input.idempotencyKey, note: input.note?.trim() || null })
      .returning();
    const at = new Date(`${input.packedOn}T12:00:00Z`);
    for (const p of plans) {
      await applySplit(tx, {
        ...p,
        docType: "packaging_session",
        docId: session!.id,
        at,
        takeReason: `Packed ${batch.code}`,
        giveReason: `Packed ${batch.code}`,
        keyPrefix: `${input.idempotencyKey}:${p.itemId}`,
      });
    }

    // Accepted jars into a finished lot per batch and size.
    let i = 0;
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId)!;
      const accepted = l.filled - l.rejected;
      const lot = await finishedLot(tx, batch, p, input.packedOn, input.bestBefore || null);
      if (accepted > 0) {
        await tx.insert(t.movements).values({
          lotId: lot.id,
          itemId: p.product.itemId,
          quantity: String(accepted),
          type: "packaging_output",
          occurredAt: at,
          docType: "packaging_session",
          docId: session!.id,
          reason: `Packed from ${batch.code}`,
          idempotencyKey: `${input.idempotencyKey}:jars:${i++}`,
        });
      }
      await tx.insert(t.packagingSessionLines).values({
        sessionId: session!.id,
        productId: p.product.id,
        packagingVersionId: versionOf.get(l.productId)!,
        fillMl: p.format.fillMl,
        filled: l.filled,
        rejected: l.rejected,
        accepted,
        finishedLotId: lot.id,
      });
    }

    await markStarted(tx, batch, "packing");
    for (const itemId of need.keys()) await syncRunReservation(tx, batch.runId, itemId);
    return { session: session!, alreadyRecorded: false };
  });
}

type SessionLine = typeof t.packagingSessionLines.$inferSelect;

/** One line per size with the sum of a session's lines (the original plus any corrections). */
export function netLines(lines: SessionLine[]): SessionLine[] {
  const out = new Map<string, SessionLine>();
  for (const l of lines) {
    const cur = out.get(l.productId);
    if (!cur) out.set(l.productId, { ...l });
    else {
      cur.filled += l.filled;
      cur.rejected += l.rejected;
      cur.accepted += l.accepted;
      cur.finishedLotId ??= l.finishedLotId;
    }
  }
  return [...out.values()];
}

/**
 * Edit or delete a packaging session, also on a closed batch. Nothing is
 * removed: the stock moves by the difference (materials back to or from
 * their lots, accepted jars in or out of the finished lot) and a deleted
 * session is only marked as deleted. If jars from the session have already
 * left stock and too few are left, it's refused with the reason.
 */
export async function changePackaging(
  db: DB,
  input: {
    idempotencyKey: string;
    sessionId: string;
    /** Delete the whole session. */
    delete?: boolean;
    reason?: string | null;
    packedOn?: string;
    bestBefore?: string | null;
    note?: string | null;
    lines?: PackagingLineInput[];
  },
) {
  if (!input.delete) {
    if (!input.packedOn || !isDate(input.packedOn)) throw new OperationError("Enter the packaging date.");
    if (input.bestBefore && !isDate(input.bestBefore)) throw new OperationError("Best-before isn't a valid date.");
    checkJarNumbers(input.lines ?? []);
  }
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(t.packagingSessions).where(eq(t.packagingSessions.id, input.sessionId));
    if (!session) throw new OperationError("Packaging session not found.");
    if (session.changeKey === input.idempotencyKey) return { alreadyRecorded: true, deleted: !!session.deletedAt };
    if (session.deletedAt) throw new OperationError("This packaging session has already been deleted.");
    const { batch, sauce } = await getBatch(tx, session.batchId);
    if (batch.status === "cancelled") throw new OperationError(`${batch.code} was marked as not made.`);

    // The session's current figures per size: original lines plus earlier corrections.
    const old = netLines(await tx.select().from(t.packagingSessionLines).where(eq(t.packagingSessionLines.sessionId, session.id)));
    const wanted = new Map((input.delete ? [] : (input.lines ?? [])).map((l) => [l.productId, l]));
    const lines = [
      ...old.map((o) => ({ productId: o.productId, filled: wanted.get(o.productId)?.filled ?? 0, rejected: wanted.get(o.productId)?.rejected ?? 0, packagingVersionId: o.packagingVersionId, old: o })),
      ...[...wanted.values()].filter((w) => !old.some((o) => o.productId === w.productId) && (w.filled > 0 || w.rejected > 0)).map((w) => ({ ...w, packagingVersionId: null, old: null })),
    ];
    if (!input.delete && !lines.some((l) => l.filled > 0 || l.rejected > 0)) {
      throw new OperationError("Enter the jars filled for at least one size, or delete the session.");
    }

    const { productRows, versionOf, need } = await packagingNeeds(tx, sauce, lines);
    // Materials used so far by this session (finished jars are handled below).
    const finishedItems = new Set(productRows.map((r) => r.product.itemId));
    const usedAll = (await usedByDocs(tx, "packaging_session", [session.id])).get(session.id) ?? new Map<string, LotSplit>();
    const used = new Map([...usedAll].filter(([itemId]) => !finishedItems.has(itemId)));
    const { plans, errors } = await planMaterials(tx, need, used);

    // Jars: the finished lot can only give back what is still in it.
    const jarMoves: { lotId: string; itemId: string; diff: number }[] = [];
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId)!;
      const diff = l.filled - l.rejected - (l.old?.accepted ?? 0);
      if (diff === 0) continue;
      const lotId = l.old?.finishedLotId ?? null;
      if (diff < 0 && lotId) {
        const left = await lotBalance(tx, lotId);
        if (left.lt(-diff)) {
          const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, lotId));
          errors.push(
            `${p.product.name}: this would take ${-diff} accepted jar${-diff === 1 ? "" : "s"} back out of stock, but lot ${lot?.code ?? ""} only has ${left} left. ` +
              `The other jars have already left stock (sold or sent out), so this session can't be ${input.delete ? "deleted" : "lowered that much"}.`,
          );
          continue;
        }
      }
      jarMoves.push({ lotId: lotId ?? "", itemId: p.product.itemId, diff });
    }
    if (errors.length) throw new OperationError(errors.join(" "));

    const when = session.packedOn;
    const what = input.delete ? `Packaging of ${when} for ${batch.code} deleted` : `Packaging of ${when} for ${batch.code} corrected`;
    const at = new Date();
    for (const p of plans) {
      await applySplit(tx, {
        ...p,
        docType: "packaging_session",
        docId: session.id,
        at,
        takeReason: what,
        giveReason: what,
        keyPrefix: `${input.idempotencyKey}:${p.itemId}`,
      });
    }

    let i = 0;
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId)!;
      const accepted = l.filled - l.rejected;
      let lotId = l.old?.finishedLotId ?? null;
      if (!lotId && (l.filled > 0 || l.rejected > 0)) lotId = (await finishedLot(tx, batch, p, input.packedOn ?? when, input.bestBefore || null)).id;
      const move = jarMoves.find((m) => m.itemId === p.product.itemId);
      if (move && lotId) {
        await tx.insert(t.movements).values({
          lotId,
          itemId: p.product.itemId,
          quantity: String(move.diff),
          type: move.diff > 0 ? "packaging_output" : "reversal",
          occurredAt: at,
          docType: "packaging_session",
          docId: session.id,
          reason: what,
          idempotencyKey: `${input.idempotencyKey}:jars:${i++}`,
        });
      }
      const dFilled = l.filled - (l.old?.filled ?? 0);
      const dRejected = l.rejected - (l.old?.rejected ?? 0);
      if (dFilled !== 0 || dRejected !== 0) {
        await tx.insert(t.packagingSessionLines).values({
          sessionId: session.id,
          productId: l.productId,
          packagingVersionId: versionOf.get(l.productId)!,
          fillMl: l.old?.fillMl ?? p.format.fillMl,
          filled: dFilled,
          rejected: dRejected,
          accepted: dFilled - dRejected,
          finishedLotId: lotId,
          changeKey: input.idempotencyKey,
        });
      }
      if (!input.delete && input.bestBefore && lotId && l.filled > 0) await tx.update(t.lots).set({ bestBefore: input.bestBefore }).where(eq(t.lots.id, lotId));
    }

    await tx
      .update(t.packagingSessions)
      .set(
        input.delete
          ? { deletedAt: at, deletedReason: input.reason?.trim() || null, updatedAt: at, changeKey: input.idempotencyKey }
          : { packedOn: input.packedOn!, note: input.note?.trim() || null, updatedAt: at, changeKey: input.idempotencyKey },
      )
      .where(eq(t.packagingSessions.id, session.id));
    for (const itemId of new Set([...need.keys(), ...used.keys()])) await syncRunReservation(tx, batch.runId, itemId);
    return { alreadyRecorded: false, deleted: !!input.delete };
  });
}

// ---------------------------------------------------------------- incidents and closing

export async function recordIncident(
  db: DB,
  input: { idempotencyKey?: string; batchId?: string | null; lotId?: string | null; type: (typeof t.incidentType.enumValues)[number]; note: string; occurredOn?: string },
) {
  if (!input.note.trim()) throw new OperationError("Describe what happened.");
  if (!input.batchId && !input.lotId) throw new OperationError("Link the incident to a batch or a lot.");
  const [row] = await db
    .insert(t.incidents)
    .values({
      batchId: input.batchId || null,
      lotId: input.lotId || null,
      type: input.type,
      note: input.note.trim(),
      occurredOn: input.occurredOn || today(),
      idempotencyKey: input.idempotencyKey || null,
    })
    .onConflictDoNothing({ target: t.incidents.idempotencyKey })
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(t.incidents).where(eq(t.incidents.idempotencyKey, input.idempotencyKey!));
  return existing!;
}

/**
 * Close a batch. Every ingredient line must be recorded first (a pending
 * line is not the same as zero). When every batch of the run is closed, the
 * run closes and any stock still reserved for it is released.
 */
export async function closeBatch(db: DB, input: { idempotencyKey: string; batchId: string; leftoverReason?: string | null; notMade?: boolean }) {
  return db.transaction(async (tx) => {
    const { batch } = await getBatch(tx, input.batchId);
    if (batch.status === "closed") return { alreadyClosed: true };
    assertOpen(batch);

    if (input.notMade) {
      const sessions = await tx
        .select({ id: t.packagingSessions.id })
        .from(t.packagingSessions)
        .where(and(eq(t.packagingSessions.batchId, batch.id), isNull(t.packagingSessions.deletedAt)));
      const used = await tx
        .select({ id: t.batchConsumption.id })
        .from(t.batchConsumption)
        .where(and(eq(t.batchConsumption.batchId, batch.id), sql`${t.batchConsumption.confirmedAt} is not null`));
      if (sessions.length || used.length) throw new OperationError("Something is already recorded for this batch, so it can't be marked as not made.");
      await tx
        .update(t.productionBatches)
        .set({ status: "cancelled", closedAt: new Date(), note: input.leftoverReason?.trim() || batch.note })
        .where(eq(t.productionBatches.id, batch.id));
      // Free the ingredients this batch had reserved.
      const lines = await tx.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
      for (const l of lines) {
        const [row] = await tx.execute<{ q: string | null }>(sql`
          select sum(quantity) as q from reservations where run_id = ${batch.runId} and item_id = ${l.itemId} and released_at is null`);
        const release = Decimal.min(new Decimal(l.plannedQty), new Decimal(row?.q ?? 0));
        if (release.gt(0)) await tx.insert(t.reservations).values({ runId: batch.runId, itemId: l.itemId, quantity: release.neg().toString() });
      }
    } else {
      const pending = await tx
        .select({ name: t.items.name })
        .from(t.batchConsumption)
        .innerJoin(t.items, eq(t.batchConsumption.itemId, t.items.id))
        .where(and(eq(t.batchConsumption.batchId, batch.id), isNull(t.batchConsumption.confirmedAt)));
      if (pending.length) throw new OperationError(`Still pending: ${pending.map((p) => p.name).join(", ")}. Record what was used (0 if none) before closing.`);
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
