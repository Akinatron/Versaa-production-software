import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DB } from "@/db/client";
import { seedCatalog } from "@/db/seed";
import { loadPlanInput } from "@/db/planning";
import { planProduction } from "@/domain/planner";
import * as t from "@/db/schema";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("database", () => {
  let db: DB;

  beforeAll(async () => {
    db = createDb(url);
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await migrate(db, { migrationsFolder: "./drizzle" });
    await seedCatalog(db);
    await seedCatalog(db); // running twice must not duplicate anything
  });
  afterAll(async () => db?.$client.end());

  it("loads the catalog once, even when seeded twice", async () => {
    const items = await db.select().from(t.items);
    expect(items.filter((i) => i.kind === "ingredient")).toHaveLength(25);
    expect(items.filter((i) => i.kind === "packaging")).toHaveLength(20);
    expect(items.filter((i) => i.kind === "finished")).toHaveLength(9);
    expect(await db.select().from(t.recipeLines)).toHaveLength(37);
  });

  it("plans from the database the same way as from the catalog", async () => {
    const input = await loadPlanInput(db, {});
    const tikka = input.sauces.find((s) => s.name === "Indiase Tikka Masala")!;
    await db.insert(t.yieldFigures).values({ sauceId: tikka.id, litresPerBatch: "25", source: "estimate", note: "test" });
    const tikka700 = input.products.find((p) => p.name === "Indiase Tikka Masala 700 ml")!;
    const r = planProduction(await loadPlanInput(db, { [tikka700.id]: 40 }));
    expect(r.sauces[0]!.batches).toBe(2);
    expect(r.requirements.find((x) => x.name === "Onions")!.required!.toString()).toBe("11.708");
  });

  it("stock comes from the ledger, and the ledger cannot be edited", async () => {
    const [item] = await db.select().from(t.items).where(sql`code = 'ing-onions'`);
    const [lot] = await db.insert(t.lots).values({ itemId: item!.id, code: "OPEN-ONIONS-1" }).returning();
    await db.insert(t.movements).values({
      lotId: lot!.id, itemId: item!.id, quantity: "10.5", type: "opening_balance",
      occurredAt: new Date(), idempotencyKey: "test-open-onions",
    });
    const input = await loadPlanInput(db, {});
    expect(input.stock[item!.id]!.onHand!.toString()).toBe("10.5");
    await expect(db.execute(sql`update movements set quantity = 0`)).rejects.toThrow();
    await expect(db.execute(sql`delete from movements`)).rejects.toThrow();
  });

  it("the same recording action can't post twice", async () => {
    const [m] = await db.select().from(t.movements).limit(1);
    await expect(
      db.insert(t.movements).values({ ...m!, id: undefined, idempotencyKey: "test-open-onions" }),
    ).rejects.toThrow();
  });
});
