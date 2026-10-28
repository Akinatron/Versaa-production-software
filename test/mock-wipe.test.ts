import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadMockData } from "@/db/mock-data";
import { wipeCounts, wipeDatabase, withDependencies } from "@/db/wipe";
import { finishedAvailability } from "@/db/sales";
import { observedYields } from "@/db/history";
import { freshDb, testDbUrl } from "./helpers";

describe("what a delete takes with it (no database)", () => {
  it("adds what the chosen parts depend on", () => {
    expect([...withDependencies(["activity"])]).toEqual(["activity"]);
    expect(new Set(withDependencies(["items"]))).toEqual(new Set(["items", "recipes", "suppliers", "activity"]));
    expect(new Set(withDependencies(["catalog"]))).toEqual(new Set(["catalog", "recipes", "activity"]));
    expect(new Set(withDependencies(["suppliers", "nonsense"]))).toEqual(new Set(["suppliers", "activity"]));
  });
});

const suite = testDbUrl ? describe : describe.skip;

suite("mock data and delete database", () => {
  let db: DB;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => db?.$client.end());

  const count = async (table: string) => Number([...(await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"`)))][0]!.n);

  it("loads an example of every stage", { timeout: 30_000 }, async () => {
    await loadMockData(db);
    const runs = await db.select().from(t.productionRuns);
    expect(new Set(runs.map((r) => r.status))).toEqual(new Set(["closed", "in_progress", "confirmed", "draft", "cancelled"]));
    const orders = await db.select().from(t.purchaseOrders);
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(["closed", "received", "cancelled", "partly_received", "sent", "draft"]));
    const batches = await db.select().from(t.productionBatches);
    expect(new Set(batches.map((b) => b.status))).toEqual(new Set(["closed", "planned", "awaiting_packaging", "packing"]));
    const sales = await db.select().from(t.salesOrders);
    expect(new Set(sales.map((s) => s.status))).toEqual(new Set(["delivered", "pending"]));
    const outflows = await db.select().from(t.outflows);
    expect(new Set(outflows.map((o) => o.type))).toEqual(new Set(["sale", "sample", "internal_use", "waste"]));
    expect(await count("incidents")).toBe(1);
    expect(await count("documents")).toBe(3);
    expect((await db.select().from(t.recipeVersions)).some((v) => v.status === "draft")).toBe(true);
    expect((await observedYields(db)).size).toBe(2);
    expect((await finishedAvailability(db)).some((a) => a.reserved.gt(0))).toBe(true);
    // Some ingredients are sold by both food suppliers, at different prices.
    const shared = await db.execute<{ n: number }>(sql`select count(*)::int as n from (
      select item_id from supplier_items where active group by item_id having count(*) > 1) x`);
    expect([...shared][0]!.n).toBeGreaterThan(5);
    const other = await db
      .select()
      .from(t.items)
      .where(sql`kind = 'other'`);
    expect(other.map((i) => i.name).sort()).toEqual(["Cleaning spray", "Nitrile gloves"]);
  });

  it("deletes only the activity, keeping the catalog and suppliers", async () => {
    const before = await wipeCounts(db);
    expect(before.runs).toBe(5);
    await wipeDatabase(db, ["activity"]);
    const after = await wipeCounts(db);
    expect(after).toMatchObject({ runs: 0, batches: 0, orders: 0, lots: 0, history: 0, documents: 0, suppliers: 4, items: before.items, sauces: 3 });
  });

  it("each part can be deleted on its own, with what depends on it", async () => {
    for (const part of ["suppliers", "recipes", "items", "catalog"]) {
      await db.$client.end();
      db = await freshDb();
      await loadMockData(db);
      const deleted = await wipeDatabase(db, [part]);
      expect(deleted.has("activity")).toBe(true);
      const c = await wipeCounts(db);
      expect(c.runs).toBe(0);
      if (part === "suppliers") expect(c).toMatchObject({ suppliers: 0, recipes: 4 });
      if (part === "recipes") expect(c).toMatchObject({ recipes: 0, packagingLists: 0, suppliers: 4 });
      if (part === "items") expect(c).toMatchObject({ items: 0, suppliers: 0, recipes: 0, sauces: 3, products: 9 });
      if (part === "catalog") expect(c).toMatchObject({ sauces: 0, products: 0, recipes: 0, suppliers: 4 });
    }
  }, 120_000);

  it("everything at once leaves an empty app", async () => {
    await wipeDatabase(db, ["activity", "suppliers", "recipes", "items", "catalog"]);
    expect(await count("items")).toBe(0);
  });
});
