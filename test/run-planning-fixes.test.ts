import { afterAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import type { PlanResult } from "@/domain/planner";
import { buildBudget } from "@/domain/pricing";
import { addSupplier, confirmRun, createPurchaseOrder, createRun, planForRun, recordOpeningCount } from "@/db/operations";
import { closeBatch, restoreBatch } from "@/db/production";
import { markOrderSent } from "@/db/purchasing";
import { addRejectFigure, setProductActive } from "@/db/catalog";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Planning a run:
 * - a batch marked as not made frees its share of the packaging too;
 * - an order expected after the run's date doesn't cover the run;
 * - a draft can't be confirmed while it asks for a size no longer in use;
 * - reject rates are saved exactly;
 * - a budget total says how many lines have an unknown quantity.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup(onionKg = "1000") {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
  for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
  for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
  for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
  await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
  const catalog = await loadPlanCatalog(db);
  const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
  const kip700 = catalog.products.find((p) => p.id === ids["Liberiaanse Kip 950 ml"])!;
  const pkg = [...new Set(catalog.products.filter((p) => p.sauceId === kip.id).flatMap((p) => p.packaging.map((x) => x.itemId)))];
  await recordOpeningCount(db, {
    idempotencyKey: "open",
    countedOn: "2026-10-17",
    lines: [
      ...kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: l.itemId === ids["ing-onions"] ? onionKg : "1000" })),
      ...pkg.map((itemId) => ({ itemId, quantity: "500" })),
    ],
  });
  return { db, ids, onion: ids["ing-onions"]!, kip700: kip700.id, jarPart: kip700.packaging[0]! };
}

const line = (plan: PlanResult, itemId: string) => plan.requirements.find((r) => r.itemId === itemId)!;

async function reserved(db: DB, runId: string, itemId: string) {
  const [r] = await db.execute<{ q: string | null }>(
    sql`select sum(quantity) as q from reservations where run_id = ${runId} and item_id = ${itemId} and released_at is null`,
  );
  return new Decimal(r?.q ?? 0).toString();
}

describe.skipIf(!testDbUrl)("a batch marked as not made", () => {
  it("frees its share of the jars, lids and labels, and Restore holds them again", async () => {
    const { db, onion, kip700, jarPart } = await setup();
    // 60 jars of 950 ml = 42 L = 2 batches of 30 L.
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [kip700]: 60 } });
    await confirmRun(db, run.id);
    const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    expect(batches).toHaveLength(2);
    const jars = new Decimal(jarPart.perJar).mul(60).toString();
    expect(await reserved(db, run.id, jarPart.itemId)).toBe(jars);
    const onionHeld = await reserved(db, run.id, onion);

    await closeBatch(db, { idempotencyKey: "nm", batchId: batches[1]!.id, notMade: true, leftoverReason: "no onions" });
    expect(await reserved(db, run.id, jarPart.itemId)).toBe(new Decimal(jarPart.perJar).mul(30).toString());
    expect(new Decimal(await reserved(db, run.id, onion)).lt(onionHeld)).toBe(true);

    await restoreBatch(db, { batchId: batches[1]!.id, reason: "onions arrived" });
    expect(await reserved(db, run.id, jarPart.itemId)).toBe(jars);
    expect(await reserved(db, run.id, onion)).toBe(onionHeld);
  });
});

describe.skipIf(!testDbUrl)("orders and the run date", () => {
  it("an order expected after the run's date doesn't cover it, and says so", async () => {
    const { db, onion, kip700 } = await setup("1");
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-11-10", targets: { [kip700]: 30 } });
    const sup = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, { idempotencyKey: "po", supplierId: sup.id, lines: [{ itemId: onion, quantity: "6", unitPrice: "1" }] });
    await markOrderSent(db, po.id, { sentOn: "2026-10-18", expectedOn: "2026-11-20" });

    const late = await planForRun(db, run.id);
    expect(line(late, onion).toBuy!.toString()).toBe("6");
    expect(line(late, onion).lateOnOrder!.toString()).toBe("6");
    expect(late.issues.map((i) => i.message).join(" ")).toMatch(/arrive after the run date/);

    // Expected on time (or with no date): it counts.
    await db.update(t.purchaseOrders).set({ expectedOn: "2026-11-09" }).where(eq(t.purchaseOrders.id, po.id));
    expect(line(await planForRun(db, run.id), onion).toBuy!.toString()).toBe("0");
    await db.update(t.purchaseOrders).set({ expectedOn: null }).where(eq(t.purchaseOrders.id, po.id));
    expect(line(await planForRun(db, run.id), onion).toBuy!.toString()).toBe("0");
  });
});

describe.skipIf(!testDbUrl)("sizes no longer in use", () => {
  it("block confirming a draft that still asks for them", async () => {
    const { db, kip700 } = await setup();
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [kip700]: 30 } });
    await setProductActive(db, kip700, false);
    const plan = await planForRun(db, run.id);
    expect(plan.issues.filter((i) => i.level === "blocker").map((i) => i.message)).toContain(
      "Liberiaanse Kip 950 ml is not in use any more. Press Edit and set it to 0, or turn it back on in Settings.",
    );
    await expect(confirmRun(db, run.id)).rejects.toThrow(/not in use any more/);
    await setProductActive(db, kip700, true);
    await confirmRun(db, run.id);
  });
});

describe.skipIf(!testDbUrl)("reject rates", () => {
  it("are saved exactly", async () => {
    const { db, kip700 } = await setup();
    await addRejectFigure(db, { productId: kip700, percent: 1.1 });
    const [r] = await db.select().from(t.rejectFigures).where(eq(t.rejectFigures.productId, kip700));
    expect(new Decimal(r!.rate).toString()).toBe("0.011");
    const p = (await loadPlanCatalog(db)).products.find((x) => x.id === kip700)!;
    expect(p.reject.rate!.toString()).toBe("0.011");
  });
});

describe("budget totals", () => {
  it("count lines whose quantity is unknown", () => {
    const b = buildBudget(
      [
        {
          itemId: "a",
          name: "Onions",
          kind: "ingredient",
          unit: "kg",
          priceText: "",
          columns: { toBuy: { quantity: new Decimal(10), cost: new Decimal(30) } },
        },
        { itemId: "b", name: "Tomatoes", kind: "ingredient", unit: "kg", priceText: "", columns: { toBuy: { quantity: null, cost: null } } },
      ],
      ["toBuy"],
    );
    expect(b.total.toBuy).toEqual({ cost: new Decimal(30), missing: 0, unknown: 1 });
  });
});
