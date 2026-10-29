import { afterAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog, loadPlanInput } from "@/db/planning";
import { planProduction, type PlanResult } from "@/domain/planner";
import { addSupplier, confirmRun, createPurchaseOrder, createRun, planForRun, recordOpeningCount } from "@/db/operations";
import { changePackaging, recordIngredients, recordPackaging } from "@/db/production";
import { markOrderSent, orderPlan, planBudget } from "@/db/purchasing";
import { linkSupplierItem, offersByItem, setSupplierActive } from "@/db/suppliers";
import { freshDb, testDbUrl } from "./helpers";

/*
 * What to buy and what stays set aside for a run:
 * - an order placed for one run is not counted again for the next one;
 * - a run that has started only asks for what it still has to use;
 * - correcting what a batch used never makes the run's reservation grow;
 * - a supplier marked "Not in use" is never proposed or priced.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup(onionKg: string) {
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
  await recordOpeningCount(db, {
    idempotencyKey: "open",
    countedOn: "2026-10-17",
    lines: [
      ...kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: l.itemId === ids["ing-onions"] ? onionKg : "1000" })),
      ...pkg.map((itemId) => ({ itemId, quantity: "500" })),
    ],
  });
  return { db, ids, onion: ids["ing-onions"]!, kip700: ids["Liberiaanse Kip 700 ml"]! };
}

const line = (plan: PlanResult, itemId: string) => plan.requirements.find((r) => r.itemId === itemId)!;

async function confirmedRun(db: DB, key: string, targets: Record<string, number>, plannedFor = "2026-10-20") {
  const run = await createRun(db, { idempotencyKey: key, plannedFor, targets });
  await confirmRun(db, run.id);
  const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
  return { run, batches };
}

async function cook(db: DB, batchId: string, key: string, override: Record<string, string> = {}, reason?: string) {
  const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
  return recordIngredients(db, {
    idempotencyKey: key,
    batchId,
    producedOn: "2026-10-20",
    reason,
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: override[l.itemId] ?? l.plannedQty })),
  });
}

async function reserved(db: DB, runId: string, itemId: string) {
  const [r] = await db.execute<{ q: string | null }>(
    sql`select sum(quantity) as q from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null`,
  );
  return new Decimal(r?.q ?? 0).toString();
}

describe.skipIf(!testDbUrl)("orders are counted once across runs", () => {
  it("a second run is not covered by the first run's order", async () => {
    const { db, onion, kip700 } = await setup("1");
    const targets = { [kip700]: 30 };
    const a = line(planProduction(await loadPlanInput(db, targets)), onion);
    expect(a.required!.toString()).toBe("7");
    expect(a.toBuy!.toString()).toBe("6");

    // Order the 6 kg run A is missing, send it, and confirm A.
    const sup = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, { idempotencyKey: "po-a", supplierId: sup.id, lines: [{ itemId: onion, quantity: "6", unitPrice: "1" }] });
    await markOrderSent(db, po.id, { sentOn: "2026-10-18" });
    const { run: runA } = await confirmedRun(db, "runa", targets);

    // Run A is covered by stock + its order.
    expect(line(await planForRun(db, runA.id), onion).toBuy!.toString()).toBe("0");

    // A new plan for the same jars needs all 7 kg: A takes the stock and the order.
    const b = line(planProduction(await loadPlanInput(db, targets)), onion);
    expect(b.toBuy!.toString()).toBe("7");
    expect(b.status).toBe("short");

    // Once B is confirmed (after A), B still asks for 7 and A still for 0:
    // between them they ask for exactly what is missing.
    const { run: runB } = await confirmedRun(db, "runb", targets, "2026-10-21");
    expect(line(await planForRun(db, runB.id), onion).toBuy!.toString()).toBe("7");
    expect(line(await planForRun(db, runA.id), onion).toBuy!.toString()).toBe("0");
  });

  it("another run's shortage is not charged to a new plan", async () => {
    const { db, onion, kip700 } = await setup("1");
    // Run A needs 7 kg, has 1 and nothing ordered: A is 6 kg short.
    const { run: runA } = await confirmedRun(db, "runa", { [kip700]: 30 });
    expect(line(await planForRun(db, runA.id), onion).toBuy!.toString()).toBe("6");
    // A new plan needs its own 7 kg, not 7 + A's 6.
    expect(line(planProduction(await loadPlanInput(db, { [kip700]: 30 })), onion).toBuy!.toString()).toBe("7");
  });
});

describe.skipIf(!testDbUrl)("a started run only checks what it still has to use", () => {
  it("cooking a batch as planned doesn't make the run ask for it again", async () => {
    const { db, onion, kip700 } = await setup("7");
    const { run, batches } = await confirmedRun(db, "run", { [kip700]: 30 });
    expect(line(await planForRun(db, run.id), onion).status).toBe("covered");
    await cook(db, batches[0]!.id, "cook-1");
    const after = line(await planForRun(db, run.id), onion);
    expect(after.required!.toString()).toBe("7");
    expect(after.stillToUse!.toString()).toBe("0");
    expect(after.toBuy!.toString()).toBe("0");
    expect(after.status).toBe("covered");
    // Nothing to order, and the budget's "To buy" is empty.
    expect(await orderPlan(db, await planForRun(db, run.id), run.id)).toEqual([]);
    const budget = await planBudget(db, await planForRun(db, run.id));
    const budgetLines = budget.groups.flatMap((g) => g.lines);
    expect(budgetLines.every((l) => l.columns.toBuy?.quantity == null || new Decimal(l.columns.toBuy.quantity).isZero())).toBe(true);
  });

  it("a run that used less than planned keeps the rest set aside and asks for nothing", async () => {
    const { db, onion, kip700 } = await setup("7");
    const { run, batches } = await confirmedRun(db, "run", { [kip700]: 30 });
    // Used 5 of the 7 kg so far: 2 kg still to use, 2 kg in stock.
    await cook(db, batches[0]!.id, "cook-1", { [onion]: "5" });
    const l = line(await planForRun(db, run.id), onion);
    expect(l.stillToUse!.toString()).toBe("2");
    expect(l.onHand!.toString()).toBe("2");
    expect(l.toBuy!.toString()).toBe("0");
  });
});

describe.skipIf(!testDbUrl)("a run's reservation never grows on its own", () => {
  it("recording again after a correction keeps the reservation", async () => {
    const { db, onion, kip700 } = await setup("1000");
    const { run, batches } = await confirmedRun(db, "run", { [kip700]: 30 });
    const b = batches[0]!;
    expect(await reserved(db, run.id, onion)).toBe("7");
    await cook(db, b.id, "cook-1");
    expect(await reserved(db, run.id, onion)).toBe("0");
    await cook(db, b.id, "cook-2", { [onion]: "5" }, "weighed again");
    expect(await reserved(db, run.id, onion)).toBe("2");
    await cook(db, b.id, "cook-3", { [onion]: "5" }, "record again");
    await cook(db, b.id, "cook-4", { [onion]: "5" }, "record again");
    expect(await reserved(db, run.id, onion)).toBe("2");
    // Back up to 7: nothing left reserved.
    await cook(db, b.id, "cook-5", { [onion]: "7" }, "it was 7 after all");
    expect(await reserved(db, run.id, onion)).toBe("0");
  });

  it("deleting and restoring a packaging session puts the reservation back where it was", async () => {
    const { db, ids, kip700 } = await setup("1000");
    const { run, batches } = await confirmedRun(db, "run", { [kip700]: 30 });
    const b = batches[0]!;
    await cook(db, b.id, "cook-1");
    const container = ids["pkg-700-ml-container"]!;
    const held = new Decimal(await reserved(db, run.id, container));
    const { session } = await recordPackaging(db, {
      idempotencyKey: "pack",
      batchId: b.id,
      packedOn: "2026-10-21",
      lines: [{ productId: kip700, filled: 10, rejected: 0 }],
    });
    const afterPack = held.minus(10).toString();
    expect(await reserved(db, run.id, container)).toBe(afterPack);
    await changePackaging(db, { idempotencyKey: "del", sessionId: session.id, delete: true, reason: "wrong batch" });
    expect(await reserved(db, run.id, container)).toBe(held.toString());
    await changePackaging(db, { idempotencyKey: "res", sessionId: session.id, restore: true, reason: "it was right" });
    expect(await reserved(db, run.id, container)).toBe(afterPack);
    await changePackaging(db, { idempotencyKey: "del2", sessionId: session.id, delete: true, reason: "wrong again" });
    expect(await reserved(db, run.id, container)).toBe(held.toString());
  });

  it("only the amount set aside at confirmation counts as the original", async () => {
    const { db, onion, kip700 } = await setup("1000");
    const { run } = await confirmedRun(db, "run", { [kip700]: 30 });
    const rows = await db
      .select()
      .from(t.reservations)
      .where(and(eq(t.reservations.runId, run.id), eq(t.reservations.itemId, onion), isNull(t.reservations.releasedAt)));
    expect(rows.map((r) => r.kind)).toEqual(["hold"]);
  });
});

describe.skipIf(!testDbUrl)("suppliers not in use", () => {
  it("are never proposed or priced; the cheapest supplier in use stands in", async () => {
    const { db, onion } = await setup("0");
    const fav = await addSupplier(db, { name: "Old favourite" });
    const dear = await addSupplier(db, { name: "Dear" });
    const cheap = await addSupplier(db, { name: "Cheap" });
    await linkSupplierItem(db, { supplierId: fav.id, itemId: onion, packQty: "10", price: "5" });
    await linkSupplierItem(db, { supplierId: dear.id, itemId: onion, packQty: "10", price: "20" });
    await linkSupplierItem(db, { supplierId: cheap.id, itemId: onion, packQty: "25", price: "25" });

    let offers = (await offersByItem(db, [onion])).get(onion)!;
    expect(offers[0]!.supplierName).toBe("Old favourite");
    expect(offers[0]!.standIn).toBeUndefined();

    await setSupplierActive(db, fav.id, false);
    offers = (await offersByItem(db, [onion])).get(onion)!;
    expect(offers.map((o) => o.supplierName)).toEqual(["Cheap", "Dear"]);
    expect(offers[0]!.rank).toBe(1);
    expect(offers[0]!.standIn).toBe(true);

    // The budget prices onions at the stand-in, never at the supplier not in use.
    const kip700 = (await db.select().from(t.products).where(eq(t.products.name, "Liberiaanse Kip 700 ml")))[0]!.id;
    const plan = planProduction(await loadPlanInput(db, { [kip700]: 10 }));
    const budget = await planBudget(db, plan);
    const onionLine = budget.groups.flatMap((g) => g.lines).find((l) => l.itemId === onion);
    expect(onionLine?.priceSource).toBe("Cheap");

    // With no supplier in use left, the item has no offers at all.
    await setSupplierActive(db, dear.id, false);
    await setSupplierActive(db, cheap.id, false);
    expect((await offersByItem(db, [onion])).get(onion)).toBeUndefined();
  });

  it("a second supplier not in use is simply left out", async () => {
    const { db, onion } = await setup("0");
    const fav = await addSupplier(db, { name: "Favourite" });
    const other = await addSupplier(db, { name: "Other" });
    await linkSupplierItem(db, { supplierId: fav.id, itemId: onion, packQty: "10", price: "50" });
    await linkSupplierItem(db, { supplierId: other.id, itemId: onion, packQty: "10", price: "5" });
    await setSupplierActive(db, other.id, false);
    const offers = (await offersByItem(db, [onion])).get(onion)!;
    expect(offers.map((o) => o.supplierName)).toEqual(["Favourite"]);
    expect(offers[0]!.standIn).toBeUndefined();
  });
});
