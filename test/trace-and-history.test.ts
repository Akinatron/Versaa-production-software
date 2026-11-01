import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { loadPlanCatalog } from "@/db/planning";
import { changePackaging, recordIngredients, recordPackaging } from "@/db/production";
import { traceBatch } from "@/db/trace";
import { addSupplier } from "@/db/operations";
import { listChanges } from "@/db/changes";
import { freshDb, testDbUrl } from "./helpers";

/*
 * - A batch's trace shows the packaging it really used: what packing took
 *   minus what a correction gave back.
 * - "Show older" in History never skips entries made in the same action.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup() {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
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
  return { db, ids, catalog };
}

describe.skipIf(!testDbUrl)("tracing a batch", () => {
  it("shows the packaging used net of what a correction gave back", async () => {
    const { db, ids, catalog } = await setup();
    const big = ids["Liberiaanse Kip 950 ml"]!;
    const perJar = catalog.products.find((p) => p.id === big)!.packaging;
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [big]: 20 } });
    await confirmRun(db, run.id);
    const [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, b!.id));
    await recordIngredients(db, {
      idempotencyKey: "cook",
      batchId: b!.id,
      producedOn: "2026-10-20",
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.plannedQty })),
    });
    const { session } = await recordPackaging(db, {
      idempotencyKey: "pack",
      batchId: b!.id,
      packedOn: "2026-10-21",
      lines: [{ productId: big, filled: 20, rejected: 0 }],
    });
    await changePackaging(db, {
      idempotencyKey: "fix",
      sessionId: session.id,
      reason: "it was 16",
      packedOn: "2026-10-21",
      lines: [{ productId: big, filled: 16, rejected: 0 }],
    });
    const trace = await traceBatch(db, b!.id);
    for (const part of perJar) {
      const used = trace!.materials.filter((m) => m.lot.itemId === part.itemId).reduce((s, m) => s + m.quantity.toNumber(), 0);
      expect(used).toBe(16 * Number(part.perJar));
    }
  });
});

describe.skipIf(!testDbUrl)("History", () => {
  it("Show older never skips entries made in the same action", async () => {
    const { db } = await setup();
    for (let i = 0; i < 30; i++) await addSupplier(db, { name: `Supplier ${i}` });
    const total = (await listChanges(db, { limit: 1000 })).length;
    const seen = new Set<string>();
    let page = await listChanges(db, { limit: 10 });
    while (page.length) {
      for (const c of page) seen.add(c.id);
      const last = page[page.length - 1]!;
      page = await listChanges(db, { limit: 10, before: last.at, beforeId: last.id });
    }
    expect(seen.size).toBe(total);
    expect(total).toBeGreaterThan(30);
  });
});
