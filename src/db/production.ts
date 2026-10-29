import { bestBeforeFrom, shelfLifeOf } from "@/domain/shelf-life";
import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, checkWholeUnits, itemsById, today, type Tx } from "./base";
import { lotBalance } from "./ledger";
import { applySplit, autoSplit, checkManualSplit, lotsOf, sameSplit, splitTotal, usedByDocs, type LotSplit } from "./lot-use";
import { convert, type UnitCode } from "@/domain/quantity";
import { batchPrefixFor, sizeTag } from "@/domain/codes";
import type { PlanResult } from "@/domain/planner";
import { diff, logChange, needReason, type FieldChange, type Ref } from "./changes";

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

/** The batch and its run, for linking a change to both pages. */
const batchRefs = (batch: { id: string; code: string; runId: string }, run?: { code: string } | null): Ref[] => [
  { type: "batch", id: batch.id, code: batch.code },
  { type: "run", id: batch.runId, code: run?.code ?? null },
];

async function lotCodes(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx.select({ id: t.lots.id, code: t.lots.code }).from(t.lots).where(inArray(t.lots.id, ids));
  return new Map(rows.map((r) => [r.id, r.code]));
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
    const items = await itemsById(
      tx,
      lines.map((l) => l.itemId),
    );

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
 * "Originally reserved" is only what was held at confirmation, minus batches
 * not made; the adjustments this function adds never count towards it.
 */
async function syncRunReservation(tx: Tx, runId: string, itemId: string) {
  const [row] = await tx.execute<{ original: string | null; current: string | null; used: string | null }>(sql`
    select
      (select coalesce(sum(quantity), 0) from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null and kind = 'hold')
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
  if (!diff.isZero()) await tx.insert(t.reservations).values({ runId, itemId, quantity: diff.toString(), kind: "adjust" });
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
export async function recordIngredients(
  db: DB,
  input: { idempotencyKey: string; batchId: string; producedOn?: string | null; lines: IngredientLineInput[]; reason?: string | null },
) {
  if (input.producedOn && !isDate(input.producedOn)) throw new OperationError("Enter the production date.");
  return db.transaction(async (tx) => {
    const { batch, run } = await getBatch(tx, input.batchId);
    const existing = await tx.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
    if (existing.some((l) => l.recordKey === input.idempotencyKey)) return { alreadyRecorded: true, changed: 0, pending: null };
    // A closed batch can still be corrected, with a reason; a batch that wasn't made can't.
    if (batch.status === "cancelled") throw new OperationError(`${batch.code} is cancelled.`);

    const seen = new Set<string>();
    for (const l of input.lines) {
      if (seen.has(l.itemId)) throw new OperationError("The same ingredient is listed twice.");
      seen.add(l.itemId);
    }
    const items = await itemsById(
      tx,
      input.lines.map((l) => l.itemId),
    );
    const byItem = new Map(existing.map((l) => [l.itemId, l]));
    const used = await usedByDocs(
      tx,
      "batch_consumption",
      existing.map((l) => l.id),
    );
    const lots = await lotsOf(
      tx,
      input.lines.map((l) => l.itemId),
    );

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

    // What changes, in words, for the history. A line recorded before and now different is a correction.
    const codes = await lotCodes(tx, [...new Set(plans.flatMap((p) => [...p.current.keys(), ...p.target.keys()]))]);
    const splitText = (split: LotSplit, unit: string) => {
      const total = splitTotal(split);
      const lots = [...split].filter(([, q]) => !q.isZero()).map(([id]) => codes.get(id) ?? "lot");
      return `${total} ${unit}${lots.length ? ` (${lots.join(", ")})` : ""}`;
    };
    const changes: FieldChange[] = [];
    let corrections = 0;
    for (const p of plans) {
      const first = !p.line?.confirmedAt;
      if (first) changes.push({ label: p.item.name, before: null, after: splitText(p.target, p.item.stockUnit) });
      else if (!sameSplit(p.current, p.target)) {
        corrections++;
        changes.push({ label: p.item.name, before: splitText(p.current, p.item.stockUnit), after: splitText(p.target, p.item.stockUnit) });
      }
    }
    if (input.producedOn && batch.producedOn && input.producedOn !== batch.producedOn) {
      corrections++;
      changes.push(...diff([["Production date", batch.producedOn, input.producedOn]]));
    }
    const correcting = corrections > 0 || (batch.status === "closed" && changes.length > 0);
    const reason = correcting ? needReason(input.reason, "Say why the ingredients are corrected") : input.reason?.trim() || null;
    const changeId = changes.length
      ? await logChange(tx, {
          action: correcting ? "update" : "create",
          area: "production",
          entity: { type: "batch", id: batch.id, code: batch.code },
          summary: correcting ? `Ingredients of ${batch.code} corrected` : `Ingredients of ${batch.code} recorded`,
          changes,
          reason,
          links: [...batchRefs(batch, run), ...[...codes].map(([id, code]) => ({ type: "lot" as const, id, code }))],
        })
      : null;

    const on = input.producedOn || batch.producedOn || today();
    const at = new Date(`${on}T12:00:00Z`);
    let changed = 0;
    for (const p of plans) {
      let line = p.line;
      if (!line) {
        [line] = await tx
          .insert(t.batchConsumption)
          .values({ batchId: batch.id, itemId: p.item.id, standardQty: "0", plannedQty: "0", extra: true })
          .returning();
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
        changeId: first ? null : changeId,
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
    if (batch.status !== "closed") await markStarted(tx, batch, "in_production");
    const [{ pending } = { pending: 0 }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(t.batchConsumption)
      .where(and(eq(t.batchConsumption.batchId, batch.id), isNull(t.batchConsumption.confirmedAt)));
    if (pending === 0 && batch.status !== "closed") await advance(tx, batch.id, "awaiting_packaging");
    return { alreadyRecorded: false, changed, pending };
  });
}

/** Record (or correct) one ingredient line. Same rules as `recordIngredients`. */
export async function recordConsumption(
  db: DB,
  input: {
    idempotencyKey: string;
    batchId: string;
    itemId: string;
    quantity: Decimal.Value;
    lots?: { lotId: string; quantity: Decimal.Value }[];
    occurredOn?: string;
    reason?: string | null;
  },
) {
  return recordIngredients(db, {
    idempotencyKey: input.idempotencyKey,
    batchId: input.batchId,
    producedOn: input.occurredOn,
    reason: input.reason,
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
    ? await tx
        .select({ product: t.products, format: t.formats })
        .from(t.products)
        .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
        .where(inArray(t.products.id, productIds))
    : [];
  const active = productIds.length
    ? await tx
        .select()
        .from(t.packagingVersions)
        .where(and(inArray(t.packagingVersions.productId, productIds), eq(t.packagingVersions.status, "active")))
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
      const target = autoSplit(
        items.get(itemId)!,
        current,
        lots.filter((l) => l.itemId === itemId),
        need.get(itemId) ?? D0,
      );
      if (!sameSplit(current, target)) plans.push({ itemId, current, target });
    } catch (e) {
      if (e instanceof OperationError) errors.push(e.message);
      else throw e;
    }
  }
  return { plans, errors };
}

/** The finished lot for this batch and size (one per batch and size), created if needed. */
async function finishedLot(
  tx: Tx,
  batch: { id: string; code: string },
  p: { product: typeof t.products.$inferSelect; format: typeof t.formats.$inferSelect },
  on: string,
  bestBefore: string | null,
) {
  let [lot] = await tx
    .select()
    .from(t.lots)
    .where(and(eq(t.lots.batchId, batch.id), eq(t.lots.itemId, p.product.itemId)));
  if (!bestBefore) {
    // No date given: packing date + this product's shelf life, when it has one.
    const [item] = await tx
      .select({ shelfLife: t.items.shelfLife, shelfLifeUnit: t.items.shelfLifeUnit })
      .from(t.items)
      .where(eq(t.items.id, p.product.itemId));
    bestBefore = item ? bestBeforeFrom(on, shelfLifeOf(item)) : null;
  }
  if (!lot) {
    [lot] = await tx
      .insert(t.lots)
      .values({ itemId: p.product.itemId, code: `${batch.code}-${sizeTag(p.format)}`, batchId: batch.id, receivedOn: on, bestBefore })
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
    const { batch, sauce, run } = await getBatch(tx, input.batchId);
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
    const finished = await tx.select({ id: t.lots.id, code: t.lots.code }).from(t.lots).where(eq(t.lots.batchId, batch.id));
    await logChange(tx, {
      action: "create",
      area: "packaging",
      entity: { type: "packaging_session", id: session!.id, code: `${batch.code} · ${input.packedOn}` },
      summary: `Packaging of ${input.packedOn} recorded for ${batch.code}`,
      changes: lines.map((l) => ({ label: productRows.find((r) => r.product.id === l.productId)!.product.name, before: null, after: jarsText(l) })),
      links: [...batchRefs(batch, run), ...finished.map((f) => ({ type: "lot" as const, id: f.id, code: f.code }))],
    });
    return { session: session!, alreadyRecorded: false };
  });
}

type SessionLine = typeof t.packagingSessionLines.$inferSelect;

const jarsText = (l: { filled: number; rejected: number }) =>
  l.filled || l.rejected ? `${l.filled} filled${l.rejected ? `, ${l.rejected} rejected` : ""}` : null;

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
    /** Bring a deleted session back with the figures it had. */
    restore?: boolean;
    reason?: string | null;
    packedOn?: string;
    /**
     * New best-before per product id, only for the sizes whose date was
     * changed (null clears it). Other sizes keep their own date. A size packed
     * for the first time in this edit gets this date or its shelf life.
     */
    bestBeforeBy?: Record<string, string | null>;
    note?: string | null;
    lines?: PackagingLineInput[];
  },
) {
  const newDates = input.delete || input.restore ? {} : (input.bestBeforeBy ?? {});
  if (!input.delete && !input.restore) {
    if (!input.packedOn || !isDate(input.packedOn)) throw new OperationError("Enter the packaging date.");
    if (Object.values(newDates).some((d) => d && !isDate(d))) throw new OperationError("Best-before isn't a valid date.");
    checkJarNumbers(input.lines ?? []);
  }
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(t.packagingSessions).where(eq(t.packagingSessions.id, input.sessionId));
    if (!session) throw new OperationError("Packaging session not found.");
    if (session.changeKey === input.idempotencyKey) return { alreadyRecorded: true, deleted: !!session.deletedAt };
    if (input.restore && !session.deletedAt) throw new OperationError("This packaging session isn't deleted.");
    if (!input.restore && session.deletedAt) throw new OperationError("This packaging session has already been deleted.");
    const { batch, sauce, run } = await getBatch(tx, session.batchId);
    if (batch.status === "cancelled") throw new OperationError(`${batch.code} was marked as not made.`);
    const reason = needReason(
      input.reason,
      input.delete ? "Say why the session is deleted" : input.restore ? "Say why the session is restored" : "Say why the packaging is corrected",
    );

    // The session's current figures per size: original lines plus earlier corrections.
    const allLines = await tx.select().from(t.packagingSessionLines).where(eq(t.packagingSessionLines.sessionId, session.id));
    const old = netLines(allLines);
    // Restoring brings back the figures from before the delete (the delete's own correction lines left out).
    const requested = input.restore
      ? netLines(allLines.filter((l) => l.changeKey !== session.changeKey)).map((l) => ({ productId: l.productId, filled: l.filled, rejected: l.rejected }))
      : input.delete
        ? []
        : (input.lines ?? []);
    const wanted = new Map(requested.map((l) => [l.productId, l]));
    const packedOn = input.restore ? session.packedOn : input.packedOn;
    const lines = [
      ...old.map((o) => ({
        productId: o.productId,
        filled: wanted.get(o.productId)?.filled ?? 0,
        rejected: wanted.get(o.productId)?.rejected ?? 0,
        packagingVersionId: o.packagingVersionId,
        old: o,
      })),
      ...[...wanted.values()]
        .filter((w) => !old.some((o) => o.productId === w.productId) && (w.filled > 0 || w.rejected > 0))
        .map((w) => ({ ...w, packagingVersionId: null, old: null })),
    ];
    if (!input.delete && !input.restore && !lines.some((l) => l.filled > 0 || l.rejected > 0)) {
      throw new OperationError("Enter the jars filled for at least one size, or delete the session.");
    }

    const { productRows, versionOf, need } = await packagingNeeds(tx, sauce, lines);
    // Materials used so far by this session (finished jars are handled below).
    const finishedItems = new Set(productRows.map((r) => r.product.itemId));
    const usedAll = (await usedByDocs(tx, "packaging_session", [session.id])).get(session.id) ?? new Map<string, LotSplit>();
    const used = new Map([...usedAll].filter(([itemId]) => !finishedItems.has(itemId)));
    const { plans, errors } = await planMaterials(tx, need, used);

    // Jars: the finished lot can only give back what is still in it.
    const jarMoves: { lotId: string; productId: string; diff: number }[] = [];
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
      jarMoves.push({ lotId: lotId ?? "", productId: l.productId, diff });
    }
    if (errors.length) throw new OperationError(errors.join(" "));

    const when = session.packedOn;
    const what = input.delete
      ? `Packaging of ${when} for ${batch.code} deleted`
      : input.restore
        ? `Packaging of ${when} for ${batch.code} restored`
        : `Packaging of ${when} for ${batch.code} corrected`;
    const at = new Date();
    const names = new Map(productRows.map((r) => [r.product.id, r.product.name]));
    // Best-before: only the sizes whose date was changed, on the lot they already have.
    const dateMoves: { lotId: string; productId: string; before: string | null; after: string | null }[] = [];
    for (const l of lines) {
      const lotId = l.old?.finishedLotId;
      if (!lotId || !(l.productId in newDates)) continue;
      const [lot] = await tx.select({ bestBefore: t.lots.bestBefore }).from(t.lots).where(eq(t.lots.id, lotId));
      const after = newDates[l.productId] || null;
      if (lot && (lot.bestBefore ?? null) !== after) dateMoves.push({ lotId, productId: l.productId, before: lot.bestBefore ?? null, after });
    }
    const changes: FieldChange[] = [
      ...lines
        .map((l) => ({ label: names.get(l.productId) ?? "Jars", before: l.old ? jarsText(l.old) : null, after: jarsText(l) }))
        .filter((c) => c.before !== c.after),
      ...dateMoves.map((m) => ({ label: `Best-before ${names.get(m.productId) ?? ""}`.trim(), before: m.before, after: m.after })),
      ...(input.delete || input.restore
        ? []
        : diff([
            ["Date", session.packedOn, packedOn],
            ["Note", session.note, input.note?.trim() || null],
          ])),
    ];
    const finishedLots = await tx.select({ id: t.lots.id, code: t.lots.code }).from(t.lots).where(eq(t.lots.batchId, batch.id));
    const changeId = await logChange(tx, {
      action: input.delete ? "delete" : input.restore ? "restore" : "update",
      area: "packaging",
      entity: { type: "packaging_session", id: session.id, code: `${batch.code} · ${session.packedOn}` },
      summary: what,
      changes,
      reason,
      links: [...batchRefs(batch, run), ...finishedLots.map((f) => ({ type: "lot" as const, id: f.id, code: f.code }))],
    });
    for (const p of plans) {
      await applySplit(tx, {
        ...p,
        docType: "packaging_session",
        docId: session.id,
        at,
        takeReason: what,
        giveReason: what,
        keyPrefix: `${input.idempotencyKey}:${p.itemId}`,
        changeId,
      });
    }

    let i = 0;
    for (const l of lines) {
      const p = productRows.find((r) => r.product.id === l.productId)!;
      const accepted = l.filled - l.rejected;
      let lotId = l.old?.finishedLotId ?? null;
      if (!lotId && (l.filled > 0 || l.rejected > 0)) lotId = (await finishedLot(tx, batch, p, packedOn ?? when, newDates[l.productId] || null)).id;
      const move = jarMoves.find((m) => m.productId === l.productId);
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
          changeId,
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
    }
    for (const m of dateMoves) await tx.update(t.lots).set({ bestBefore: m.after }).where(eq(t.lots.id, m.lotId));

    await tx
      .update(t.packagingSessions)
      .set(
        input.delete
          ? { deletedAt: at, deletedReason: reason, updatedAt: at, changeKey: input.idempotencyKey }
          : input.restore
            ? { deletedAt: null, deletedReason: null, updatedAt: at, changeKey: input.idempotencyKey }
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
  input: {
    idempotencyKey?: string;
    batchId?: string | null;
    lotId?: string | null;
    type: (typeof t.incidentType.enumValues)[number];
    note: string;
    occurredOn?: string;
  },
) {
  if (!input.note.trim()) throw new OperationError("Describe what happened.");
  if (!input.batchId && !input.lotId) throw new OperationError("Link the incident to a batch or a lot.");
  return db.transaction(async (tx) => {
    const [row] = await tx
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
    if (!row) {
      const [existing] = await tx.select().from(t.incidents).where(eq(t.incidents.idempotencyKey, input.idempotencyKey!));
      return existing!;
    }
    await logChange(tx, {
      action: "create",
      area: "production",
      entity: { type: "incident", id: row.id, code: INCIDENT[row.type] },
      summary: `Incident recorded: ${INCIDENT[row.type].toLowerCase()}`,
      changes: [{ label: "What happened", after: row.note }],
      links: await incidentRefs(tx, row),
    });
    return row;
  });
}

const INCIDENT: Record<(typeof t.incidentType.enumValues)[number], string> = { loss: "Loss", spill: "Spill", quality: "Quality", other: "Other" };

async function incidentRefs(tx: Tx, row: typeof t.incidents.$inferSelect): Promise<Ref[]> {
  const refs: Ref[] = [];
  if (row.batchId) {
    const { batch, run } = await getBatch(tx, row.batchId);
    refs.push(...batchRefs(batch, run));
  }
  if (row.lotId) {
    const [lot] = await tx.select({ id: t.lots.id, code: t.lots.code }).from(t.lots).where(eq(t.lots.id, row.lotId));
    if (lot) refs.push({ type: "lot", id: lot.id, code: lot.code });
  }
  return refs;
}

/** Correct an incident's kind, date or description. It never moved stock. */
export async function updateIncident(
  db: DB,
  input: { incidentId: string; reason: string; type: (typeof t.incidentType.enumValues)[number]; note: string; occurredOn: string },
) {
  const reason = needReason(input.reason, "Say why the incident is corrected");
  if (!input.note.trim()) throw new OperationError("Describe what happened.");
  if (!isDate(input.occurredOn)) throw new OperationError("Enter the date.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.incidents).where(eq(t.incidents.id, input.incidentId));
    if (!row) throw new OperationError("Incident not found.");
    if (row.deletedAt) throw new OperationError("This incident was deleted. Restore it first.");
    const changes = diff([
      ["Kind", INCIDENT[row.type], INCIDENT[input.type]],
      ["Date", row.occurredOn, input.occurredOn],
      ["What happened", row.note, input.note.trim()],
    ]);
    if (!changes.length) return;
    await tx.update(t.incidents).set({ type: input.type, note: input.note.trim(), occurredOn: input.occurredOn }).where(eq(t.incidents.id, row.id));
    await logChange(tx, {
      action: "update",
      area: "production",
      entity: { type: "incident", id: row.id, code: INCIDENT[input.type] },
      summary: "Incident corrected",
      changes,
      reason,
      links: await incidentRefs(tx, row),
    });
  });
}

/** Delete or restore an incident. Deleted ones stay on record, marked. */
export async function setIncidentDeleted(db: DB, input: { incidentId: string; deleted: boolean; reason: string }) {
  const reason = needReason(input.reason, input.deleted ? "Say why the incident is deleted" : "Say why the incident is restored");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.incidents).where(eq(t.incidents.id, input.incidentId));
    if (!row) throw new OperationError("Incident not found.");
    if (!!row.deletedAt === input.deleted) return;
    await tx
      .update(t.incidents)
      .set(
        input.deleted
          ? { deletedAt: new Date(), deletedReason: reason }
          : { deletedAt: null, deletedReason: null },
      )
      .where(eq(t.incidents.id, row.id));
    await logChange(tx, {
      action: input.deleted ? "delete" : "restore",
      area: "production",
      entity: { type: "incident", id: row.id, code: INCIDENT[row.type] },
      summary: input.deleted ? "Incident deleted" : "Incident restored",
      changes: [{ label: "What happened", before: input.deleted ? row.note : null, after: input.deleted ? null : row.note }],
      reason,
      links: await incidentRefs(tx, row),
    });
  });
}

/** Correct a batch's production date or note. */
export async function updateBatch(db: DB, input: { batchId: string; reason: string; producedOn?: string | null; note?: string | null }) {
  const reason = needReason(input.reason, "Say why the batch is corrected");
  if (input.producedOn && !isDate(input.producedOn)) throw new OperationError("Enter the production date.");
  return db.transaction(async (tx) => {
    const { batch, run } = await getBatch(tx, input.batchId);
    const upd = {
      ...(input.producedOn !== undefined ? { producedOn: input.producedOn || null } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
    };
    const changes = diff([
      ["Production date", batch.producedOn, upd.producedOn === undefined ? batch.producedOn : upd.producedOn],
      ["Note", batch.note, upd.note === undefined ? batch.note : upd.note],
    ]);
    if (!changes.length) return;
    await tx.update(t.productionBatches).set(upd).where(eq(t.productionBatches.id, batch.id));
    await logChange(tx, {
      action: "update",
      area: "production",
      entity: { type: "batch", id: batch.id, code: batch.code },
      summary: `${batch.code} corrected`,
      changes,
      reason,
      links: batchRefs(batch, run),
    });
  });
}

/**
 * Bring back a batch marked as not made, so it can be cooked after all. Its
 * ingredients are reserved again. Not possible once its run is closed.
 */
export async function restoreBatch(db: DB, input: { batchId: string; reason: string }) {
  const reason = needReason(input.reason, "Say why the batch is restored");
  return db.transaction(async (tx) => {
    const { batch, run } = await getBatch(tx, input.batchId);
    if (batch.status !== "cancelled") throw new OperationError(`${batch.code} isn't marked as not made.`);
    if (run.status === "closed" || run.status === "cancelled")
      throw new OperationError(`Run ${run.code} is ${run.status}, so its batches can't come back. Plan a new run instead.`);
    await tx.update(t.productionBatches).set({ status: "planned", closedAt: null }).where(eq(t.productionBatches.id, batch.id));
    const lines = await tx.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
    for (const l of lines) await syncRunReservation(tx, batch.runId, l.itemId);
    await logChange(tx, {
      action: "restore",
      area: "production",
      entity: { type: "batch", id: batch.id, code: batch.code },
      summary: `${batch.code} back on the plan: its ingredients are reserved again`,
      changes: diff([["Status", "Not made", "To cook"]]),
      reason,
      links: batchRefs(batch, run),
    });
  });
}

/**
 * Close a batch. Every ingredient line must be recorded first (a pending
 * line is not the same as zero). When every batch of the run is closed, the
 * run closes and any stock still reserved for it is released.
 */
export async function closeBatch(db: DB, input: { idempotencyKey: string; batchId: string; leftoverReason?: string | null; notMade?: boolean }) {
  return db.transaction(async (tx) => {
    const { batch, run } = await getBatch(tx, input.batchId);
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
        if (release.gt(0)) await tx.insert(t.reservations).values({ runId: batch.runId, itemId: l.itemId, quantity: release.neg().toString(), kind: "adjust" });
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
      await tx
        .update(t.reservations)
        .set({ releasedAt: new Date() })
        .where(and(eq(t.reservations.runId, batch.runId), isNull(t.reservations.releasedAt)));
      await tx.update(t.productionRuns).set({ status: "closed" }).where(eq(t.productionRuns.id, batch.runId));
    }
    await logChange(tx, {
      action: input.notMade ? "cancel" : "status",
      area: "production",
      entity: { type: "batch", id: batch.id, code: batch.code },
      summary: input.notMade ? `${batch.code} marked as not made` : `${batch.code} closed`,
      changes: diff([
        ["Status", "Open", input.notMade ? "Not made" : "Closed"],
        ...(open.length === 0 ? [["Run", null, `${run.code} closed`] as [string, unknown, unknown]] : []),
      ]),
      reason: input.notMade ? input.leftoverReason : null,
      links: batchRefs(batch, run),
    });
    return { alreadyClosed: false, runClosed: open.length === 0 };
  });
}

// ---------------------------------------------------------------- packaging form helpers

export interface PackMaterial {
  itemId: string;
  perJar: number;
}

export interface PackStock {
  name: string;
  unit: string;
  /** What a session can use: lots with stock, plus what the session being edited already uses. */
  available: string;
}

/**
 * What the packaging form needs to warn while typing: the materials per jar
 * of each size (the session's own packaging version when editing, else the
 * active one) and how much of each material can be used. Mirrors the check
 * made when saving.
 */
export async function packFormMaterials(db: DB, sizes: { productId: string; packagingVersionId?: string | null }[], editingSessionId?: string) {
  const productIds = sizes.map((s) => s.productId);
  const active = productIds.length
    ? await db
        .select()
        .from(t.packagingVersions)
        .where(and(inArray(t.packagingVersions.productId, productIds), eq(t.packagingVersions.status, "active")))
    : [];
  const versionOf = new Map(sizes.map((s) => [s.productId, s.packagingVersionId ?? active.find((v) => v.productId === s.productId)?.id ?? null]));
  const versionIds = [...new Set([...versionOf.values()].filter((v): v is string => !!v))];
  const lines = versionIds.length ? await db.select().from(t.packagingLines).where(inArray(t.packagingLines.packagingVersionId, versionIds)) : [];
  const materials: Record<string, PackMaterial[]> = {};
  for (const id of productIds)
    materials[id] = lines.filter((l) => l.packagingVersionId === versionOf.get(id)).map((l) => ({ itemId: l.itemId, perJar: l.perJar }));

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const stock: Record<string, PackStock> = {};
  if (!itemIds.length) return { materials, stock };
  const [items, lots, used] = await Promise.all([
    itemsById(db as unknown as Tx, itemIds),
    lotsOf(db as unknown as Tx, itemIds),
    editingSessionId ? usedByDocs(db as unknown as Tx, "packaging_session", [editingSessionId]) : Promise.resolve(new Map<string, Map<string, LotSplit>>()),
  ]);
  const mine = editingSessionId ? (used.get(editingSessionId) ?? new Map<string, LotSplit>()) : new Map<string, LotSplit>();
  for (const id of itemIds) {
    const item = items.get(id)!;
    const inLots = lots.filter((l) => l.itemId === id).reduce((s, l) => s.plus(Decimal.max(D0, l.balance)), D0);
    const own = mine.get(id);
    stock[id] = { name: item.name, unit: item.stockUnit, available: inLots.plus(own ? splitTotal(own) : D0).toString() };
  }
  return { materials, stock };
}

/**
 * The jars the run planned for this batch's sauce, per size: from the forecast
 * saved at confirmation, shared evenly over the sauce's batches in the run,
 * with what the run's batches of this sauce have packed so far.
 */
export async function plannedJarsForBatch(db: DB, batch: { id: string; runId: string; sauceId: string }) {
  const [snap] = await db.select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, batch.runId));
  if (!snap) return null;
  const plan = snap.data as PlanResult;
  const products = await db.select({ id: t.products.id, sauceId: t.products.sauceId }).from(t.products);
  const ofSauce = new Set(products.filter((p) => p.sauceId === batch.sauceId).map((p) => p.id));
  const lines = plan.products.filter((p) => ofSauce.has(p.productId) && p.jarsToFill > 0);
  if (!lines.length) return null;
  const batches = await db
    .select({ id: t.productionBatches.id })
    .from(t.productionBatches)
    .where(and(eq(t.productionBatches.runId, batch.runId), eq(t.productionBatches.sauceId, batch.sauceId), sql`${t.productionBatches.status} <> 'cancelled'`));
  const count = Math.max(1, batches.length);
  const packed = await db.execute<{ product_id: string; filled: number; this_batch: number }>(sql`
    select l.product_id, sum(l.filled)::int as filled, sum(case when s.batch_id = ${batch.id} then l.filled else 0 end)::int as this_batch
    from packaging_session_lines l
    join packaging_sessions s on s.id = l.session_id and s.deleted_at is null
    join production_batches b on b.id = s.batch_id
    where b.run_id = ${batch.runId} and b.sauce_id = ${batch.sauceId}
    group by l.product_id`);
  const packedBy = new Map([...packed].map((r) => [r.product_id, r]));
  return {
    batchCount: count,
    sizes: lines.map((p) => ({
      productId: p.productId,
      name: p.name,
      targetJars: p.targetJars,
      runToFill: p.jarsToFill,
      /** This batch's share of the jars to fill (rounded up). */
      perBatch: Math.ceil(p.jarsToFill / count),
      runFilled: packedBy.get(p.productId)?.filled ?? 0,
      batchFilled: packedBy.get(p.productId)?.this_batch ?? 0,
    })),
  };
}
