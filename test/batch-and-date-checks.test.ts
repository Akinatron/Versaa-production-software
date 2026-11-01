import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { isDate } from "@/db/base";
import { loadPlanCatalog } from "@/db/planning";
import { confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { closeBatch, recordIncident, recordIngredients, restoreBatch, updateBatch } from "@/db/production";
import { freshDb, testDbUrl } from "./helpers";

/*
 * - Marking a batch as not made keeps its reason apart and never touches the
 *   batch's note; restoring leaves the note as it was.
 * - Dates and whole units are checked when saving, not only in the form.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup() {
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
    lines: [...kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: "1000" })), ...pkg.map((itemId) => ({ itemId, quantity: "500" }))],
  });
  const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 950 ml"]!]: 60 } }); // 2 batches
  await confirmRun(db, run.id);
  const [batch] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
  return { db, ids, batch: batch! };
}

describe.skipIf(!testDbUrl)("a batch marked as not made", () => {
  it("keeps the reason apart, and the note is never changed", async () => {
    const { db, batch } = await setup();
    await updateBatch(db, { batchId: batch.id, reason: "note", note: "Use the big pot" });
    await closeBatch(db, { idempotencyKey: "nm", batchId: batch.id, notMade: true, leftoverReason: "  no onions  " });
    let [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.id, batch.id));
    expect(b!.note).toBe("Use the big pot");
    expect(b!.notMadeReason).toBe("no onions");

    await restoreBatch(db, { batchId: batch.id, reason: "onions arrived" });
    [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.id, batch.id));
    expect(b!.note).toBe("Use the big pot");
    expect(b!.notMadeReason).toBeNull();
  });

  it("needs a reason", async () => {
    const { db, batch } = await setup();
    await expect(closeBatch(db, { idempotencyKey: "nm", batchId: batch.id, notMade: true, leftoverReason: " " })).rejects.toThrow(/wasn't made/);
  });
});

describe("dates", () => {
  it("must be real calendar days", () => {
    expect(isDate("2026-10-29")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("")).toBe(false);
    expect(isDate(null)).toBe(false);
  });
});

describe.skipIf(!testDbUrl)("checks made when saving", () => {
  it("an opening count needs a valid date", async () => {
    const { db, ids } = await setup();
    const line = { itemId: ids["ing-onions"]!, quantity: "1" };
    await expect(recordOpeningCount(db, { idempotencyKey: "x", countedOn: "", lines: [line] })).rejects.toThrow("Enter the date of the count.");
    await expect(recordOpeningCount(db, { idempotencyKey: "x", countedOn: "2026-02-31", lines: [line] })).rejects.toThrow("Enter the date of the count.");
    await expect(recordOpeningCount(db, { idempotencyKey: "x", countedOn: "2026-10-17", lines: [{ ...line, bestBefore: "soon" }] })).rejects.toThrow(
      "Best-before isn't a valid date.",
    );
  });

  it("an incident needs a valid date", async () => {
    const { db, batch } = await setup();
    await expect(recordIncident(db, { batchId: batch.id, type: "spill", note: "Dropped a pot", occurredOn: "2026-10-40" })).rejects.toThrow(
      "Enter the date of the incident.",
    );
    const ok = await recordIncident(db, { batchId: batch.id, type: "spill", note: "Dropped a pot", occurredOn: "2026-10-20" });
    expect(ok.occurredOn).toBe("2026-10-20");
  });

  it("a hand-picked lot of something counted in units takes whole units", async () => {
    const { db, ids, batch } = await setup();
    const onion = ids["ing-onions"]!;
    // As if onions were counted in whole units.
    await db.update(t.items).set({ stockUnit: "unit" }).where(eq(t.items.id, onion));
    const [first] = await db.select().from(t.lots).where(eq(t.lots.itemId, onion));
    const [second] = await db.insert(t.lots).values({ itemId: onion, code: "OPEN-20261017-999", receivedOn: "2026-10-17" }).returning();
    await db
      .insert(t.movements)
      .values({
        lotId: second!.id,
        itemId: onion,
        quantity: "10",
        type: "opening_balance",
        occurredAt: new Date("2026-10-17T00:00:00Z"),
        idempotencyKey: "second-lot",
      });
    await expect(
      recordIngredients(db, {
        idempotencyKey: "rec",
        batchId: batch.id,
        lines: [
          {
            itemId: onion,
            quantity: "1",
            lots: [
              { lotId: first!.id, quantity: "0.5" },
              { lotId: second!.id, quantity: "0.5" },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/counted in whole units: enter a whole number for each lot/);
  });
});
