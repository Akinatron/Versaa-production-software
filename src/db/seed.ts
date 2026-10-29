import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { loadSeedCatalog } from "@/domain/seed-catalog";
import { batchPrefixFor } from "@/domain/codes";
import { SAUCE_COLORS } from "@/domain/sauce-colors";
import { getSetting, setSetting } from "./app-settings";

/**
 * Load the starting catalog. Safe to run more than once: anything that
 * already exists (by code) is left untouched, so it never rewrites history.
 */
export async function seedCatalog(db: DB) {
  const c = loadSeedCatalog();
  await db.transaction(async (tx) => {
    const itemIds = new Map<string, string>();
    const upsertItem = async (code: string, name: string, kind: "ingredient" | "packaging" | "finished", stockUnit: "kg" | "L" | "unit" | "g" | "ml") => {
      await tx.insert(t.items).values({ code, name, kind, stockUnit }).onConflictDoNothing({ target: t.items.code });
      const [row] = await tx.select({ id: t.items.id }).from(t.items).where(eq(t.items.code, code));
      itemIds.set(code, row!.id);
    };
    for (const i of c.items) await upsertItem(i.id, i.name, i.kind, i.stockUnit);

    const sauceIds = new Map<string, string>();
    const byName = [...c.sauces].sort((a, b) => a.name.localeCompare(b.name)).map((s) => s.code);
    for (const s of c.sauces) {
      const color = SAUCE_COLORS[byName.indexOf(s.code) % (SAUCE_COLORS.length - 1)]!.key;
      await tx
        .insert(t.sauces)
        .values({ code: s.code, name: s.name, batchPrefix: batchPrefixFor(s.name), color })
        .onConflictDoNothing({ target: t.sauces.code });
      const [row] = await tx.select({ id: t.sauces.id }).from(t.sauces).where(eq(t.sauces.code, s.code));
      sauceIds.set(s.code, row!.id);
      const existing = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.sauceId, row!.id));
      if (existing.length === 0) {
        const [v] = await tx
          .insert(t.recipeVersions)
          .values({
            sauceId: row!.id,
            versionNo: 1,
            batchReferenceKg: s.batchReferenceKg.toString(),
            status: "active",
            activatedAt: new Date(),
            note: "Starting recipe provided by Pablo (17 Oct 2026).",
          })
          .returning();
        await tx.insert(t.recipeLines).values(
          s.lines.map((l, idx) => ({
            recipeVersionId: v!.id,
            itemId: itemIds.get(l.itemCode)!,
            quantity: l.quantity.toString(),
            unit: l.unit,
            position: idx + 1,
          })),
        );
      }
    }

    const formatIds = new Map<string, string>();
    for (const f of c.formats) {
      await tx
        .insert(t.formats)
        .values({ code: f.code, name: f.name, capacityMl: f.capacityMl, fillMl: f.capacityMl })
        .onConflictDoNothing({ target: t.formats.code });
      const [row] = await tx.select({ id: t.formats.id }).from(t.formats).where(eq(t.formats.code, f.code));
      formatIds.set(f.code, row!.id);
    }

    for (const p of c.products) {
      await upsertItem(`fin-${p.code}`, p.name, "finished", "unit");
      await tx
        .insert(t.products)
        .values({ sauceId: sauceIds.get(p.sauceCode)!, formatId: formatIds.get(p.formatCode)!, itemId: itemIds.get(`fin-${p.code}`)!, name: p.name })
        .onConflictDoNothing();
      const [prod] = await tx.select({ id: t.products.id }).from(t.products).where(eq(t.products.itemId, itemIds.get(`fin-${p.code}`)!));
      const existing = await tx.select().from(t.packagingVersions).where(eq(t.packagingVersions.productId, prod!.id));
      if (existing.length === 0) {
        const [v] = await tx
          .insert(t.packagingVersions)
          .values({ productId: prod!.id, versionNo: 1, status: "active", activatedAt: new Date() })
          .returning();
        await tx.insert(t.packagingLines).values(
          p.packaging.map((x) => ({ packagingVersionId: v!.id, itemId: itemIds.get(x.itemCode)!, perJar: x.perJar })),
        );
      }
    }
  });
}

/**
 * Add the planning estimates of litres per batch, but only for sauces that
 * have no yield figure yet, so it never overrides a figure entered later.
 */
export async function seedYieldEstimates(db: DB) {
  const c = loadSeedCatalog();
  let added = 0;
  await db.transaction(async (tx) => {
    for (const e of c.yieldEstimates) {
      const [sauce] = await tx.select({ id: t.sauces.id }).from(t.sauces).where(eq(t.sauces.code, e.sauceCode));
      if (!sauce) continue;
      const existing = await tx.select({ id: t.yieldFigures.id }).from(t.yieldFigures).where(eq(t.yieldFigures.sauceId, sauce.id)).limit(1);
      if (existing.length > 0) continue;
      await tx.insert(t.yieldFigures).values({ sauceId: sauce.id, litresPerBatch: e.litresPerBatch.toString(), source: "estimate", note: e.note });
      added++;
    }
  });
  return { added };
}

/** App setting marking that the starting catalog has been loaded into this database. */
export const CATALOG_LOADED = "catalog_loaded";

/**
 * Load the starting catalog and yield estimates once per database (the
 * desktop app's first start). The mark is saved only after both are in, so a
 * first start that was cut short loads them on the next one; both steps are
 * safe to repeat. Once marked, it never loads again, so what was deleted
 * later stays deleted.
 */
export async function loadStartingCatalogOnce(db: DB): Promise<{ loaded: boolean; added: number }> {
  if (await getSetting(db, CATALOG_LOADED, false)) return { loaded: false, added: 0 };
  await seedCatalog(db);
  const { added } = await seedYieldEstimates(db);
  await setSetting(db, CATALOG_LOADED, true);
  return { loaded: true, added };
}
