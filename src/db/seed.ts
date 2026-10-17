import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { loadSeedCatalog } from "@/domain/seed-catalog";

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
    for (const s of c.sauces) {
      await tx.insert(t.sauces).values({ code: s.code, name: s.name }).onConflictDoNothing({ target: t.sauces.code });
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
