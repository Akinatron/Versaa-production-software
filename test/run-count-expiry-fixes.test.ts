import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { addSupplier, confirmRun, createRun, planForRun, recordOpeningCount } from "@/db/operations";
import { changePackaging, closeBatch, recordIngredients, recordPackaging, restoreBatch } from "@/db/production";
import { correctReceipt, recordReceipt } from "@/db/purchasing";
import { recordStockCount, recordWriteOff, setAdjustmentDeleted } from "@/db/adjustments";
import { recordOutflow, updateOutflow } from "@/db/sales";
import { lotBalance } from "@/db/ledger";
import { addDays, today } from "@/domain/dates";
import { freshDb, testDbUrl } from "./helpers";

/*
 * - A run that has started asks for what its uncooked batches plan to use,
 *   even when a cooked batch used more than planned (FAL-38).
 * - A count with a past date places every change on its own document's date,
 *   so a correction or deletion done later isn't counted twice; dates in the
 *   future are refused (FAL-36).
 * - Lots past their best-before don't count in plans and aren't taken
 *   automatically when cooking or packing (FAL-39).
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

const day = (n: number) => addDays(today(), n);

async function setup(onionKg: string, opts: { countedOn?: string; onionBestBefore?: string | null; pkgQty?: string } = {}) {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
  for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
  for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
  for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
  await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
  const catalog = await loadPlanCatalog(db);
  const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
  const pkg = [...new Set(catalog.products.filter((p) => p.sauceId === kip.id).flatMap((p) => p.packaging.map((x) => x.itemId)))];
  const onion = ids["ing-onions"]!;
  await recordOpeningCount(db, {
    idempotencyKey: "open",
    countedOn: opts.countedOn ?? day(-30),
    lines: [
      ...kip.recipe!.lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.itemId === onion ? onionKg : "1000",
        bestBefore: l.itemId === onion ? (opts.onionBestBefore ?? null) : null,
      })),
      ...pkg.map((itemId) => ({ itemId, quantity: opts.pkgQty ?? "500" })),
    ],
  });
  return { db, ids, onion, pkg, big: ids["Liberiaanse Kip 700 ml"]! };
}

async function runWith(db: DB, key: string, targets: Record<string, number>, plannedFor = day(-10)) {
  const run = await createRun(db, { idempotencyKey: key, plannedFor, targets });
  await confirmRun(db, run.id);
  const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id)).orderBy(t.productionBatches.code);
  return { run, batches };
}

async function cook(db: DB, batchId: string, key: string, override: Record<string, string> = {}, on = day(-10)) {
  const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
  return recordIngredients(db, {
    idempotencyKey: key,
    batchId,
    producedOn: on,
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: override[l.itemId] ?? l.plannedQty })),
  });
}

async function reserved(db: DB, runId: string, itemId: string) {
  const [r] = await db.execute<{ q: string | null }>(
    sql`select coalesce(sum(quantity), 0)::text as q from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null`,
  );
  return Number(r?.q ?? 0);
}

async function plannedOnion(db: DB, batchId: string, onion: string) {
  const [l] = await db
    .select()
    .from(t.batchConsumption)
    .where(and(eq(t.batchConsumption.batchId, batchId), eq(t.batchConsumption.itemId, onion)));
  return Number(l!.plannedQty);
}

describe.skipIf(!testDbUrl)("a started run keeps what its uncooked batches need", () => {
  it("a batch that used more than planned doesn't leave the next one short", async () => {
    const { db, onion, big } = await setup("14");
    const { run, batches } = await runWith(db, "run", { [big]: 60 });
    expect(batches.length).toBe(2);
    const planned = await plannedOnion(db, batches[1]!.id, onion);
    await cook(db, batches[0]!.id, "cook1", { [onion]: String((await plannedOnion(db, batches[0]!.id, onion)) + 3) });

    // Still to use is the second batch's planned onions, not "reserved − used".
    expect(await reserved(db, run.id, onion)).toBeCloseTo(planned, 6);
    const plan = await planForRun(db, run.id);
    const line = plan.requirements.find((r) => r.itemId === onion)!;
    expect(Number(line.stillToUse)).toBeCloseTo(planned, 6);
    expect(line.status).toBe("short");
    expect(Number(line.toBuy)).toBeGreaterThan(0);
  });

  it("correcting a cooked batch or marking one as not made keeps the rule", async () => {
    const { db, onion, big } = await setup("1000");
    const { run, batches } = await runWith(db, "run", { [big]: 60 });
    const p2 = await plannedOnion(db, batches[1]!.id, onion);
    await cook(db, batches[0]!.id, "cook1");
    expect(await reserved(db, run.id, onion)).toBeCloseTo(p2, 6);
    await closeBatch(db, { idempotencyKey: "nm", batchId: batches[1]!.id, notMade: true, leftoverReason: "no time" });
    expect(await reserved(db, run.id, onion)).toBe(0);
    await restoreBatch(db, { batchId: batches[1]!.id, reason: "we make it after all" });
    expect(await reserved(db, run.id, onion)).toBeCloseTo(p2, 6);
    await cook(db, batches[1]!.id, "cook2");
    expect(await reserved(db, run.id, onion)).toBe(0);
  });
});

describe.skipIf(!testDbUrl)("a count with a past date and later changes", () => {
  it("a write-off deleted later isn't counted twice", async () => {
    const { db, onion } = await setup("12");
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.itemId, onion));
    const wo = await recordWriteOff(db, {
      idempotencyKey: "wo",
      type: "waste",
      reason: "rotten",
      occurredOn: day(-10),
      lines: [{ lotId: lot!.id, quantity: "4" }],
    });
    await setAdjustmentDeleted(db, { idempotencyKey: "del", adjustmentId: wo.adjustment.id, deleted: true, reason: "entered by mistake" });
    await recordStockCount(db, { idempotencyKey: "cnt", countedOn: day(-5), reason: "count", lines: [{ lotId: lot!.id, counted: "12" }] });
    expect((await lotBalance(db as never, lot!.id)).toString()).toBe("12");
  });

  it("a delivery corrected later isn't counted twice", async () => {
    const { db, onion } = await setup("0");
    const sup = await addSupplier(db, { name: "Groente BV" });
    const { receipt } = await recordReceipt(db, {
      idempotencyKey: "rcv",
      supplierId: sup.id,
      receivedOn: day(-10),
      lines: [{ itemId: onion, quantity: "25" }],
    });
    const [line] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, receipt.id));
    await correctReceipt(db, {
      idempotencyKey: "fix",
      receiptId: receipt.id,
      reason: "typo",
      receivedOn: day(-10),
      lines: [{ lineId: line!.id, quantity: "20" }],
    });
    await recordStockCount(db, { idempotencyKey: "cnt", countedOn: day(-5), reason: "count", lines: [{ lotId: line!.lotId!, counted: "20" }] });
    expect((await lotBalance(db as never, line!.lotId!)).toString()).toBe("20");
  });

  it("an exit whose date was moved earlier counts on its new date", async () => {
    const { db, big } = await setup("1000");
    const { batches } = await runWith(db, "run", { [big]: 30 }, day(-12));
    await cook(db, batches[0]!.id, "cook", {}, day(-12));
    await recordPackaging(db, { idempotencyKey: "pack", batchId: batches[0]!.id, packedOn: day(-12), lines: [{ productId: big, filled: 20, rejected: 0 }] });
    const [jarLot] = await db.select().from(t.lots).where(eq(t.lots.batchId, batches[0]!.id));
    const r = await recordOutflow(db, { idempotencyKey: "smp", type: "sample", occurredOn: day(-2), note: "fair", lines: [{ productId: big, jars: 5 }] });
    await updateOutflow(db, { outflowId: r.outflow.id, reason: "they left earlier", occurredOn: day(-8) });
    await recordStockCount(db, { idempotencyKey: "cnt", countedOn: day(-5), reason: "count", lines: [{ lotId: jarLot!.id, counted: "15" }] });
    expect((await lotBalance(db as never, jarLot!.id)).toString()).toBe("15");
  });

  it("dates in the future are refused", async () => {
    const { db, onion, big } = await setup("1000");
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.itemId, onion));
    const sup = await addSupplier(db, { name: "Groente BV" });
    const tomorrow = day(1);
    await expect(
      recordReceipt(db, { idempotencyKey: "rcv", supplierId: sup.id, receivedOn: tomorrow, lines: [{ itemId: onion, quantity: "20" }] }),
    ).rejects.toThrow(/delivery date can't be in the future/);
    await expect(
      recordStockCount(db, { idempotencyKey: "cnt", countedOn: tomorrow, reason: "count", lines: [{ lotId: lot!.id, counted: "5" }] }),
    ).rejects.toThrow(/count date can't be in the future/);
    await expect(
      recordWriteOff(db, { idempotencyKey: "wo", type: "waste", reason: "x", occurredOn: tomorrow, lines: [{ lotId: lot!.id, quantity: "1" }] }),
    ).rejects.toThrow(/in the future/);
    const { batches } = await runWith(db, "run", { [big]: 30 });
    await expect(cook(db, batches[0]!.id, "cook", {}, tomorrow)).rejects.toThrow(/production date can't be in the future/);
    await cook(db, batches[0]!.id, "cook");
    await expect(
      recordPackaging(db, { idempotencyKey: "pack", batchId: batches[0]!.id, packedOn: tomorrow, lines: [{ productId: big, filled: 20, rejected: 0 }] }),
    ).rejects.toThrow(/packaging date can't be in the future/);
    const { session } = await recordPackaging(db, {
      idempotencyKey: "pack",
      batchId: batches[0]!.id,
      packedOn: today(),
      lines: [{ productId: big, filled: 20, rejected: 0 }],
    });
    await expect(
      changePackaging(db, {
        idempotencyKey: "chg",
        sessionId: session.id,
        reason: "x",
        packedOn: tomorrow,
        lines: [{ productId: big, filled: 20, rejected: 0 }],
      }),
    ).rejects.toThrow(/packaging date can't be in the future/);
    await expect(
      recordOutflow(db, { idempotencyKey: "out", type: "sample", note: "x", occurredOn: tomorrow, lines: [{ productId: big, jars: 1 }] }),
    ).rejects.toThrow(/in the future/);
  });
});

describe.skipIf(!testDbUrl)("lots past their best-before", () => {
  async function expiredSetup() {
    const s = await setup("1000", { countedOn: day(-30), onionBestBefore: day(-20) });
    const sup = await addSupplier(s.db, { name: "Groente BV" });
    await recordReceipt(s.db, {
      idempotencyKey: "rcv",
      supplierId: sup.id,
      receivedOn: day(-5),
      lines: [{ itemId: s.onion, quantity: "20", bestBefore: day(30) }],
    });
    return s;
  }

  it("aren't counted in a run's plan, with a warning", async () => {
    const { db, onion, big } = await expiredSetup();
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: today(), targets: { [big]: 60 } });
    const plan = await planForRun(db, run.id);
    const line = plan.requirements.find((r) => r.itemId === onion)!;
    expect(line.onHand?.toString()).toBe("20");
    expect(line.expired?.toString()).toBe("1000");
    expect(plan.issues.some((i) => i.message.includes("past best-before"))).toBe(true);
    // The stock pages still show what is physically there.
    expect((await loadStockPositions(db))[onion]!.onHand?.toString()).toBe("1020");
  });

  it("a lot expiring before the run's date isn't counted, though it is today", async () => {
    const { db, onion, big } = await setup("1000", { countedOn: day(-3), onionBestBefore: day(5) });
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: day(10), targets: { [big]: 30 } });
    const line = (await planForRun(db, run.id)).requirements.find((r) => r.itemId === onion)!;
    expect(line.onHand?.toString()).toBe("0");
    expect(line.status).toBe("short");
  });

  it("are skipped when cooking, and can still be picked by hand", async () => {
    const { db, onion, big } = await expiredSetup();
    const { batches } = await runWith(db, "run", { [big]: 30 }, today());
    await cook(db, batches[0]!.id, "cook", {}, today());
    const used = await db.execute<{ best_before: string; q: string }>(sql`
      select l.best_before::text, (-sum(m.quantity))::text as q from movements m join lots l on l.id = m.lot_id
      where m.item_id = ${onion} and m.type = 'consumption' group by l.best_before`);
    expect([...used].map((r) => r.best_before)).toEqual([day(30)]);

    // Not enough in date: a clear message naming the old lot.
    const { batches: more } = await runWith(db, "run2", { [big]: 30 }, today());
    const left = 20 - Number([...used][0]!.q);
    await expect(cook(db, more[0]!.id, "cook2", { [onion]: String(left + 1) }, today())).rejects.toThrow(/within its best-before.*OPEN-/);

    // By hand it's allowed.
    const [oldLot] = await db
      .select()
      .from(t.lots)
      .where(and(eq(t.lots.itemId, onion), eq(t.lots.bestBefore, day(-20))));
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, more[0]!.id));
    await recordIngredients(db, {
      idempotencyKey: "cook3",
      batchId: more[0]!.id,
      producedOn: today(),
      lines: lines.map((l) =>
        l.itemId === onion
          ? { itemId: onion, quantity: "", lots: [{ lotId: oldLot!.id, quantity: l.plannedQty }] }
          : { itemId: l.itemId, quantity: l.plannedQty },
      ),
    });
    expect(Number(await lotBalance(db as never, oldLot!.id))).toBeLessThan(1000);
  });
});
