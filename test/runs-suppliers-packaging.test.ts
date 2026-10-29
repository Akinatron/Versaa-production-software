import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { addSupplier, confirmRun, createRun, recordOpeningCount, runTargets, updateDraftRun } from "@/db/operations";
import { packFormMaterials, plannedJarsForBatch, recordPackaging } from "@/db/production";
import { linkSupplierItem, loadOffers } from "@/db/suppliers";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

suite("draft run edits, favourite suppliers and the packaging form", () => {
  let db: DB;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
  });
  afterAll(async () => db?.$client.end());

  it("a draft run's date and targets can be changed, the code follows the date, and the change is in the history", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const run = await createRun(db, { idempotencyKey: "abcd-draft", plannedFor: "2026-10-20", targets: { [big]: 30 } });
    expect(run.code).toBe("RUN-20261020-01");

    await expect(updateDraftRun(db, run.id, "2026-10-22", { [big]: 0 })).rejects.toThrow(/at least one/);
    await expect(updateDraftRun(db, run.id, "2026-10-22", { [big]: 2.5 })).rejects.toThrow(/whole numbers/);
    await expect(updateDraftRun(db, run.id, "", { [big]: 10 })).rejects.toThrow(/date/);

    await updateDraftRun(db, run.id, "2026-10-22", { [big]: 60 }, "bigger order");
    const [after] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, run.id));
    expect(after!.plannedFor).toBe("2026-10-22");
    expect(after!.code).toBe("RUN-20261022-01");
    expect(await runTargets(db, run.id)).toEqual({ [big]: 60 });
    const log = await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, run.id));
    const edit = log.find((l) => l.action === "update")!;
    expect(edit.reason).toBe("bigger order");
    expect(JSON.stringify(edit.changes)).toContain("60 jars");

    await confirmRun(db, run.id).catch(() => null);
    const [now] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, run.id));
    if (now!.status === "confirmed") await expect(updateDraftRun(db, run.id, "2026-10-23", { [big]: 10 })).rejects.toThrow(/Only draft/);
  });

  it("a supplier can be made the favourite when it is linked, from either card", async () => {
    const a = (await addSupplier(db, { name: "Groente BV" })).id;
    const b = (await addSupplier(db, { name: "Metro" })).id;
    const onions = ids["ing-onions"]!;
    await linkSupplierItem(db, { supplierId: a, itemId: onions, packQty: "25", price: "12" });
    await linkSupplierItem(db, { supplierId: b, itemId: onions, packQty: "10", price: "6", favourite: true });
    const offers = await loadOffers(db, { itemIds: [onions] });
    expect(offers.map((o) => [o.supplierName, o.rank])).toEqual([
      ["Metro", 1],
      ["Groente BV", 2],
    ]);
    // The supplier card reads the same rows.
    expect((await loadOffers(db, { supplierId: b })).map((o) => o.rank)).toEqual([1]);
  });

  it("the packaging form knows the materials per jar, what is in stock, and the jars planned for the batch", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const kip = (await loadPlanCatalog(db)).sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
    const pkg = (await loadPlanCatalog(db)).products.find((p) => p.id === big)!.packaging;
    await recordOpeningCount(db, {
      idempotencyKey: "open-pack",
      countedOn: "2026-10-17",
      lines: [...kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: "100" })), ...pkg.map((p) => ({ itemId: p.itemId, quantity: "100" }))],
    });
    const run = await createRun(db, { idempotencyKey: "pack-run", plannedFor: "2026-10-24", targets: { [big]: 30 } });
    await confirmRun(db, run.id);
    const [batch] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));

    const fresh = await packFormMaterials(db, [{ productId: big }]);
    expect(fresh.materials[big]!.map((m) => m.itemId).sort()).toEqual(pkg.map((p) => p.itemId).sort());
    expect(fresh.stock[pkg[0]!.itemId]!.available).toBe("100");

    const planned = await plannedJarsForBatch(db, batch!);
    expect(planned!.batchCount).toBe(1);
    expect(planned!.sizes[0]!.productId).toBe(big);
    expect(planned!.sizes[0]!.perBatch).toBeGreaterThanOrEqual(30);
    expect(planned!.sizes[0]!.batchFilled).toBe(0);

    const { session } = await recordPackaging(db, {
      idempotencyKey: "pk-1",
      batchId: batch!.id,
      packedOn: "2026-10-24",
      lines: [{ productId: big, filled: 25, rejected: 1 }],
    });
    // When editing that session, what it already used counts as available again.
    const editing = await packFormMaterials(db, [{ productId: big }], session.id);
    expect(editing.stock[pkg[0]!.itemId]!.available).toBe("100");
    expect((await packFormMaterials(db, [{ productId: big }])).stock[pkg[0]!.itemId]!.available).toBe(String(100 - 25 * pkg[0]!.perJar));
    expect((await plannedJarsForBatch(db, batch!))!.sizes[0]!.batchFilled).toBe(25);
  });
});
