import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { changePackaging, recordIngredients, recordPackaging } from "@/db/production";
import { activatePackagingDraft, addFormat, addProduct, savePackagingDraft, setItemShelfLife, startPackagingDraft } from "@/db/catalog";
import { changesFor } from "@/db/changes";
import { lotBalance } from "@/db/ledger";
import { sizeTag } from "@/domain/codes";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Every size keeps its own stock, lots and dates, even when two sizes hold
 * the same ml; editing a packaging session only changes the best-before of a
 * size whose date was changed.
 */

const dbs: DB[] = [];
const balance = (db: DB, lotId: string) => lotBalance(db as never, lotId);
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
  return { db, ids };
}

async function cookedBatch(db: DB, key: string, targets: Record<string, number>) {
  const run = await createRun(db, { idempotencyKey: key, plannedFor: "2026-10-20", targets });
  await confirmRun(db, run.id);
  const [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
  const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, b!.id));
  await recordIngredients(db, {
    idempotencyKey: `${key}-cook`,
    batchId: b!.id,
    producedOn: "2026-10-20",
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.plannedQty })),
  });
  return b!;
}

describe("size tags", () => {
  it("drop the f of a size code", () => {
    expect(sizeTag({ code: "f250" })).toBe("250");
    expect(sizeTag({ code: "f250-2" })).toBe("250-2");
    expect(sizeTag({ code: "gift" })).toBe("gift");
  });
});

describe.skipIf(!testDbUrl)("two sizes with the same ml", () => {
  it("each get their own stock item and lot, and deleting a session puts both back to 0", async () => {
    const { db, ids } = await setup();
    const jar = ids["Liberiaanse Kip 250 ml"]!;
    const f = await addFormat(db, { name: "250 ml bottle", capacityMl: 250 });
    expect(f.code).toBe("f250-2");
    const bottle = await addProduct(db, { sauceId: ids["liberiaanse-kip"]!, formatId: f.id });
    const [jarRow] = await db.select().from(t.products).where(eq(t.products.id, jar));
    expect(bottle.itemId).not.toBe(jarRow!.itemId);
    const [item] = await db.select().from(t.items).where(eq(t.items.id, bottle.itemId));
    expect(item!.code).toBe("fin-liberiaanse-kip-250-2");

    const v = await startPackagingDraft(db, bottle.id);
    await savePackagingDraft(db, { versionId: v.id, lines: [{ itemId: ids["pkg-250-ml-container"]!, perJar: "1" }] });
    await activatePackagingDraft(db, v.id);

    const b = await cookedBatch(db, "run", { [jar]: 10, [bottle.id]: 5 });
    const { session } = await recordPackaging(db, {
      idempotencyKey: "pack",
      batchId: b.id,
      packedOn: "2026-10-21",
      lines: [
        { productId: jar, filled: 10, rejected: 0 },
        { productId: bottle.id, filled: 5, rejected: 0 },
      ],
    });
    const lots = await db.select().from(t.lots).where(eq(t.lots.batchId, b.id));
    const jarLot = lots.find((l) => l.itemId === jarRow!.itemId)!;
    const bottleLot = lots.find((l) => l.itemId === bottle.itemId)!;
    expect(jarLot.code).toBe(`${b.code}-250`);
    expect(bottleLot.code).toBe(`${b.code}-250-2`);
    expect((await balance(db, jarLot.id)).toString()).toBe("10");
    expect((await balance(db, bottleLot.id)).toString()).toBe("5");

    // Correct only the bottles, then delete the session: each lot moves on its own.
    await changePackaging(db, {
      idempotencyKey: "edit",
      sessionId: session.id,
      reason: "one bottle short",
      packedOn: "2026-10-21",
      lines: [
        { productId: jar, filled: 10, rejected: 0 },
        { productId: bottle.id, filled: 4, rejected: 0 },
      ],
    });
    expect((await balance(db, jarLot.id)).toString()).toBe("10");
    expect((await balance(db, bottleLot.id)).toString()).toBe("4");
    await changePackaging(db, { idempotencyKey: "del", sessionId: session.id, delete: true, reason: "wrong batch" });
    expect((await balance(db, jarLot.id)).toString()).toBe("0");
    expect((await balance(db, bottleLot.id)).toString()).toBe("0");
  });

  it("a product can't take over another product's stock item", async () => {
    const { db, ids } = await setup();
    const f = await addFormat(db, { name: "250 ml bottle", capacityMl: 250 });
    // Someone already made an item with the code the new product would get, and a product uses it.
    const [other] = await db.select().from(t.products).where(eq(t.products.name, "Liberiaanse Kip 250 ml"));
    await db.update(t.items).set({ code: "fin-liberiaanse-kip-250-2" }).where(eq(t.items.id, other!.itemId));
    await expect(addProduct(db, { sauceId: ids["liberiaanse-kip"]!, formatId: f.id })).rejects.toThrow(/already keeps its jars/);
  });
});

describe.skipIf(!testDbUrl)("best-before when editing a packaging session", () => {
  async function packedTwoSizes() {
    const { db, ids } = await setup();
    await setItemShelfLife(db, ids["fin-liberiaanse-kip-700"]!, "6", "months");
    await setItemShelfLife(db, ids["fin-liberiaanse-kip-250"]!, "12", "months");
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const small = ids["Liberiaanse Kip 250 ml"]!;
    const b = await cookedBatch(db, "run", { [big]: 20, [small]: 20 });
    const { session } = await recordPackaging(db, {
      idempotencyKey: "pack",
      batchId: b.id,
      packedOn: "2026-10-28",
      lines: [
        { productId: big, filled: 20, rejected: 1 },
        { productId: small, filled: 20, rejected: 0 },
      ],
    });
    const dates = async () => Object.fromEntries((await db.select().from(t.lots).where(eq(t.lots.batchId, b.id))).map((l) => [l.code.slice(-3), l.bestBefore]));
    return { db, big, small, session, dates };
  }

  it("each size keeps its own date when only the jars are corrected", async () => {
    const { db, big, small, session, dates } = await packedTwoSizes();
    expect(await dates()).toEqual({ "700": "2027-04-28", "250": "2027-10-28" });
    await changePackaging(db, {
      idempotencyKey: "edit",
      sessionId: session.id,
      reason: "rejects were 2",
      packedOn: "2026-10-28",
      bestBeforeBy: {},
      lines: [
        { productId: big, filled: 20, rejected: 2 },
        { productId: small, filled: 20, rejected: 0 },
      ],
    });
    expect(await dates()).toEqual({ "700": "2027-04-28", "250": "2027-10-28" });
  });

  it("changing one size's date changes only that lot and goes in the history", async () => {
    const { db, big, small, session, dates } = await packedTwoSizes();
    await changePackaging(db, {
      idempotencyKey: "edit",
      sessionId: session.id,
      reason: "label printed with a shorter date",
      packedOn: "2026-10-28",
      bestBeforeBy: { [small]: "2027-09-30" },
      lines: [
        { productId: big, filled: 20, rejected: 1 },
        { productId: small, filled: 20, rejected: 0 },
      ],
    });
    expect(await dates()).toEqual({ "700": "2027-04-28", "250": "2027-09-30" });
    const edit = (await changesFor(db, { type: "packaging_session", id: session.id })).find((e) => e.action === "update")!;
    expect(edit.changes).toContainEqual({ label: "Best-before Liberiaanse Kip 250 ml", before: "2027-10-28", after: "2027-09-30" });
  });
});
