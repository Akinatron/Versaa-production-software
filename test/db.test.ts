import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DB } from "@/db/client";
import { seedCatalog, seedYieldEstimates } from "@/db/seed";
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
    expect(items.filter((i) => i.kind === "ingredient")).toHaveLength(23);
    expect(items.filter((i) => i.kind === "packaging")).toHaveLength(20);
    expect(items.filter((i) => i.kind === "finished")).toHaveLength(9);
    expect(await db.select().from(t.recipeLines)).toHaveLength(36);
  });

  it("loads the sizes by jar capacity, with the sauce each one holds", async () => {
    const formats = await db.select().from(t.formats);
    expect(formats.map((f) => [f.name, f.capacityMl, f.fillMl]).sort()).toEqual([
      ["250 ml", 250, 200],
      ["450 ml", 450, 350],
      ["950 ml", 950, 750],
    ]);
    const items = await db.select().from(t.items);
    expect(items.some((i) => i.name === "Palm sugar" || i.name === "Salt")).toBe(false);
  });

  it("loads Pablo's suppliers once: Boerschappen per kg, Jumbo per pack, packaging and celery powder left open", async () => {
    const sups = await db.select().from(t.suppliers);
    expect(sups.map((x) => x.name).sort()).toEqual(["Boerschappen", "Jumbo"]);
    const rows = await db.execute<{ supplier: string; code: string; rank: number; pack_qty: string | null; pack_name: string | null; price: string }>(sql`
      select s.name as supplier, i.code, si.rank, p.pack_qty::text, p.pack_name, p.price::text
      from supplier_items si join suppliers s on s.id = si.supplier_id join items i on i.id = si.item_id
      join supplier_item_prices p on p.supplier_item_id = si.id`);
    const offer = (code: string) => [...rows].find((r) => r.code === code)!;
    expect([...rows].filter((r) => r.supplier === "Boerschappen")).toHaveLength(11);
    expect([...rows].filter((r) => r.supplier === "Jumbo")).toHaveLength(11);
    expect([...rows].every((r) => r.rank === 1)).toBe(true);
    // Bought by weight: 346.35 € for 25.58 kg → 13.54 €/kg, no pack size.
    expect(offer("ing-chicken-thighs")).toMatchObject({ supplier: "Boerschappen", pack_qty: null, price: "13.54" });
    expect(offer("ing-onions")).toMatchObject({ pack_qty: null, price: "1.32" });
    // Fixed packs: a 42 g jar of cumin, a 200 ml bottle of lemon juice.
    expect(offer("ing-ground-cumin")).toMatchObject({ supplier: "Jumbo", pack_qty: "0.042", price: "2.89" });
    expect(offer("ing-lemon-juice")).toMatchObject({ pack_qty: "0.2", price: "0.63" });
    expect(offer("ing-sea-salt")).toMatchObject({ supplier: "Jumbo", pack_qty: "1", price: "2.01" });
    const offered = new Set([...rows].map((r) => r.code));
    const open = (await db.select().from(t.items)).filter((i) => (i.kind === "ingredient" || i.kind === "packaging") && !offered.has(i.code));
    expect(open.filter((i) => i.kind === "ingredient").map((i) => i.code)).toEqual(["ing-celery-powder"]);
    expect(open.filter((i) => i.kind === "packaging")).toHaveLength(20);
  });

  it("plans from the database the same way as from the catalog", async () => {
    const input = await loadPlanInput(db, {});
    const tikka = input.sauces.find((s) => s.name === "Indiase Tikka Masala")!;
    await db.insert(t.yieldFigures).values({ sauceId: tikka.id, litresPerBatch: "25", source: "estimate", note: "test" });
    const tikka950 = input.products.find((p) => p.name === "Indiase Tikka Masala 950 ml")!;
    const r = planProduction(await loadPlanInput(db, { [tikka950.id]: 40 }));
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

  it("adds the 30 L estimates once, labelled as estimates, without overriding a figure already entered", async () => {
    // Tikka already has a 25 L figure from the test above.
    expect((await seedYieldEstimates(db)).added).toBe(2);
    expect((await seedYieldEstimates(db)).added).toBe(0);
    const input = await loadPlanInput(db, {});
    const bySauce = Object.fromEntries(input.sauces.map((s) => [s.name, s.yield]));
    expect(bySauce["Indiase Tikka Masala"]!.litresPerBatch!.toString()).toBe("25");
    expect(bySauce["Italiaanse Bolognese"]!.litresPerBatch!.toString()).toBe("30");
    expect(bySauce["Liberiaanse Kip"]!.source).toBe("estimate");
  });
});
