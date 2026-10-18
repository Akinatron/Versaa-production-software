import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError } from "./base";
import { batchPrefixFor } from "@/domain/codes";
import { dimensionOf, isUnitCode, type UnitCode } from "@/domain/quantity";
import { slug } from "@/domain/seed-catalog";

/*
 * Changing the catalog (Settings). Recipes and packaging lists are edited as
 * a new draft version and then activated; the old version is retired, not
 * changed, so batches made with it keep pointing at what they really used.
 * Nothing in the catalog is deleted: items, sauces, sizes and products are
 * retired so their history stays readable.
 */

// ---------------------------------------------------------------- recipes

/** Start a new draft from the current recipe (or empty). Returns the existing draft if there is one. */
export async function startRecipeDraft(db: DB, sauceId: string) {
  return db.transaction(async (tx) => {
    const versions = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.sauceId, sauceId));
    const draft = versions.find((v) => v.status === "draft");
    if (draft) return draft;
    const active = versions.find((v) => v.status === "active");
    const versionNo = Math.max(0, ...versions.map((v) => v.versionNo)) + 1;
    const [v] = await tx
      .insert(t.recipeVersions)
      .values({ sauceId, versionNo, batchReferenceKg: active?.batchReferenceKg ?? "30", status: "draft" })
      .returning();
    if (active) {
      const lines = await tx.select().from(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, active.id));
      if (lines.length) {
        await tx.insert(t.recipeLines).values(lines.map((l) => ({ recipeVersionId: v!.id, itemId: l.itemId, quantity: l.quantity, unit: l.unit, position: l.position })));
      }
    }
    return v!;
  });
}

export interface RecipeLineInput {
  itemId: string;
  quantity: string;
  unit: string;
}

/** Replace a draft's lines and reference data. Only drafts can change. */
export async function saveRecipeDraft(db: DB, input: { versionId: string; batchReferenceKg: string; note?: string | null; lines: RecipeLineInput[] }) {
  const lines = input.lines.filter((l) => l.itemId);
  const ref = new Decimal(input.batchReferenceKg || "NaN");
  if (ref.isNaN() || ref.lte(0)) throw new OperationError("Batch size must be more than 0 kg.");
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.id, input.versionId));
    if (!v) throw new OperationError("Recipe version not found.");
    if (v.status !== "draft") throw new OperationError("Only a draft can be changed. Start a new version instead.");
    const items = new Map((await tx.select().from(t.items)).map((i) => [i.id, i]));
    const seen = new Set<string>();
    const rows = lines.map((l, idx) => {
      const item = items.get(l.itemId);
      if (!item || item.kind !== "ingredient") throw new OperationError("Recipe lines must be ingredients.");
      if (seen.has(item.id)) throw new OperationError(`${item.name} is listed twice.`);
      seen.add(item.id);
      if (!isUnitCode(l.unit)) throw new OperationError(`${item.name}: choose a unit.`);
      if (dimensionOf(l.unit) !== dimensionOf(item.stockUnit as UnitCode)) {
        throw new OperationError(`${item.name} is stocked in ${item.stockUnit}, so the recipe can't use ${l.unit}.`);
      }
      const q = new Decimal(l.quantity || "NaN");
      if (q.isNaN() || q.lte(0)) throw new OperationError(`${item.name}: enter a quantity more than 0, or remove the line.`);
      return { recipeVersionId: v.id, itemId: item.id, quantity: q.toString(), unit: l.unit as UnitCode, position: idx + 1 };
    });
    await tx.delete(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, v.id));
    if (rows.length) await tx.insert(t.recipeLines).values(rows);
    await tx.update(t.recipeVersions).set({ batchReferenceKg: ref.toString(), note: input.note?.trim() || null }).where(eq(t.recipeVersions.id, v.id));
  });
}

/** Make a draft the recipe used from now on. The previous version is retired, never edited. */
export async function activateRecipeDraft(db: DB, versionId: string) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.id, versionId));
    if (!v || v.status !== "draft") throw new OperationError("Only a draft can be activated.");
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, v.id));
    if (n === 0) throw new OperationError("A recipe needs at least one ingredient.");
    await tx.update(t.recipeVersions).set({ status: "retired" }).where(and(eq(t.recipeVersions.sauceId, v.sauceId), eq(t.recipeVersions.status, "active")));
    await tx.update(t.recipeVersions).set({ status: "active", activatedAt: new Date() }).where(eq(t.recipeVersions.id, v.id));
  });
}

/** Throw away an unused draft. */
export async function discardRecipeDraft(db: DB, versionId: string) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.id, versionId));
    if (!v || v.status !== "draft") throw new OperationError("Only a draft can be discarded.");
    await tx.delete(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, v.id));
    await tx.delete(t.recipeVersions).where(eq(t.recipeVersions.id, v.id));
  });
}

// ---------------------------------------------------------------- packaging lists

export async function startPackagingDraft(db: DB, productId: string) {
  return db.transaction(async (tx) => {
    const versions = await tx.select().from(t.packagingVersions).where(eq(t.packagingVersions.productId, productId));
    const draft = versions.find((v) => v.status === "draft");
    if (draft) return draft;
    const active = versions.find((v) => v.status === "active");
    const versionNo = Math.max(0, ...versions.map((v) => v.versionNo)) + 1;
    const [v] = await tx.insert(t.packagingVersions).values({ productId, versionNo, status: "draft" }).returning();
    if (active) {
      const lines = await tx.select().from(t.packagingLines).where(eq(t.packagingLines.packagingVersionId, active.id));
      if (lines.length) await tx.insert(t.packagingLines).values(lines.map((l) => ({ packagingVersionId: v!.id, itemId: l.itemId, perJar: l.perJar })));
    }
    return v!;
  });
}

export async function savePackagingDraft(db: DB, input: { versionId: string; lines: { itemId: string; perJar: string }[] }) {
  const lines = input.lines.filter((l) => l.itemId);
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.packagingVersions).where(eq(t.packagingVersions.id, input.versionId));
    if (!v) throw new OperationError("Packaging version not found.");
    if (v.status !== "draft") throw new OperationError("Only a draft can be changed. Start a new version instead.");
    const items = new Map((await tx.select().from(t.items)).map((i) => [i.id, i]));
    const seen = new Set<string>();
    const rows = lines.map((l) => {
      const item = items.get(l.itemId);
      if (!item || item.kind !== "packaging") throw new OperationError("Packaging lines must be packaging items.");
      if (seen.has(item.id)) throw new OperationError(`${item.name} is listed twice.`);
      seen.add(item.id);
      const n = Number(l.perJar);
      if (!Number.isInteger(n) || n < 1) throw new OperationError(`${item.name}: per jar must be a whole number, 1 or more.`);
      return { packagingVersionId: v.id, itemId: item.id, perJar: n };
    });
    await tx.delete(t.packagingLines).where(eq(t.packagingLines.packagingVersionId, v.id));
    if (rows.length) await tx.insert(t.packagingLines).values(rows);
  });
}

export async function activatePackagingDraft(db: DB, versionId: string) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.packagingVersions).where(eq(t.packagingVersions.id, versionId));
    if (!v || v.status !== "draft") throw new OperationError("Only a draft can be activated.");
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.packagingLines).where(eq(t.packagingLines.packagingVersionId, v.id));
    if (n === 0) throw new OperationError("A packaging list needs at least one item.");
    await tx.update(t.packagingVersions).set({ status: "retired" }).where(and(eq(t.packagingVersions.productId, v.productId), eq(t.packagingVersions.status, "active")));
    await tx.update(t.packagingVersions).set({ status: "active", activatedAt: new Date() }).where(eq(t.packagingVersions.id, v.id));
  });
}

export async function discardPackagingDraft(db: DB, versionId: string) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.packagingVersions).where(eq(t.packagingVersions.id, versionId));
    if (!v || v.status !== "draft") throw new OperationError("Only a draft can be discarded.");
    await tx.delete(t.packagingLines).where(eq(t.packagingLines.packagingVersionId, v.id));
    await tx.delete(t.packagingVersions).where(eq(t.packagingVersions.id, v.id));
  });
}

// ---------------------------------------------------------------- items, sauces, sizes, products

async function uniqueCode(db: DB, base: string, table: typeof t.items | typeof t.sauces | typeof t.formats) {
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
    if (!row) return code;
  }
}

export async function addItem(db: DB, input: { kind: "ingredient" | "packaging"; name: string; stockUnit: string }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Name is required.");
  if (!isUnitCode(input.stockUnit)) throw new OperationError("Choose a stock unit.");
  if (input.kind === "packaging" && input.stockUnit !== "unit") throw new OperationError("Packaging is counted in units.");
  const [dup] = await db.select().from(t.items).where(and(eq(t.items.name, name), eq(t.items.kind, input.kind)));
  if (dup) throw new OperationError(`${name} already exists.`);
  const code = await uniqueCode(db, `${input.kind === "ingredient" ? "ing" : "pkg"}-${slug(name)}`, t.items);
  const [row] = await db.insert(t.items).values({ code, name, kind: input.kind, stockUnit: input.stockUnit }).returning();
  return row!;
}

export async function renameItem(db: DB, itemId: string, name: string) {
  if (!name.trim()) throw new OperationError("Name is required.");
  await db.update(t.items).set({ name: name.trim() }).where(eq(t.items.id, itemId));
}

/** Retire or bring back an item. Its stock and history stay. */
export async function setItemActive(db: DB, itemId: string, active: boolean) {
  if (!active) {
    const used = await db.execute<{ name: string }>(sql`
      select s.name from recipe_lines l join recipe_versions v on v.id = l.recipe_version_id join sauces s on s.id = v.sauce_id
      where l.item_id = ${itemId} and v.status = 'active'
      union
      select p.name from packaging_lines l join packaging_versions v on v.id = l.packaging_version_id join products p on p.id = v.product_id
      where l.item_id = ${itemId} and v.status = 'active'`);
    const names = [...used].map((u) => u.name);
    if (names.length) throw new OperationError(`Still used by: ${names.join(", ")}. Remove it from those first (as a new version).`);
  }
  await db.update(t.items).set({ active }).where(eq(t.items.id, itemId));
}

export async function addSauce(db: DB, input: { name: string; batchPrefix?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Name is required.");
  const code = await uniqueCode(db, slug(name), t.sauces);
  const prefix = (input.batchPrefix?.trim() || batchPrefixFor(name)).toUpperCase().slice(0, 5);
  const [row] = await db.insert(t.sauces).values({ code, name, batchPrefix: prefix }).returning();
  return row!;
}

export async function setSauceActive(db: DB, sauceId: string, active: boolean) {
  await db.update(t.sauces).set({ active }).where(eq(t.sauces.id, sauceId));
}

export async function addFormat(db: DB, input: { name: string; capacityMl: number; fillMl?: number | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Name is required.");
  if (!Number.isInteger(input.capacityMl) || input.capacityMl <= 0) throw new OperationError("Capacity must be a whole number of ml.");
  const fill = input.fillMl ?? input.capacityMl;
  if (!Number.isInteger(fill) || fill <= 0 || fill > input.capacityMl) throw new OperationError("Fill must be between 1 ml and the capacity.");
  const code = await uniqueCode(db, `f${input.capacityMl}`, t.formats);
  const [row] = await db.insert(t.formats).values({ code, name, capacityMl: input.capacityMl, fillMl: fill }).returning();
  return row!;
}

/** Change how much goes in each jar from now on. Past packaging keeps the fill it used. */
export async function setFormatFill(db: DB, formatId: string, fillMl: number) {
  const [f] = await db.select().from(t.formats).where(eq(t.formats.id, formatId));
  if (!f) throw new OperationError("Size not found.");
  if (!Number.isInteger(fillMl) || fillMl <= 0 || fillMl > f.capacityMl) throw new OperationError(`Fill must be between 1 and ${f.capacityMl} ml.`);
  await db.update(t.formats).set({ fillMl }).where(eq(t.formats.id, formatId));
}

export async function setFormatActive(db: DB, formatId: string, active: boolean) {
  await db.update(t.formats).set({ active }).where(eq(t.formats.id, formatId));
}

/** A new sellable product (sauce × size). Give it a packaging list before planning it. */
export async function addProduct(db: DB, input: { sauceId: string; formatId: string }) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.sauces).where(eq(t.sauces.id, input.sauceId));
    const [f] = await tx.select().from(t.formats).where(eq(t.formats.id, input.formatId));
    if (!s || !f) throw new OperationError("Choose a sauce and a size.");
    const [dup] = await tx.select().from(t.products).where(and(eq(t.products.sauceId, s.id), eq(t.products.formatId, f.id)));
    if (dup) {
      if (!dup.active) await tx.update(t.products).set({ active: true }).where(eq(t.products.id, dup.id));
      return dup;
    }
    const name = `${s.name} ${f.name}`;
    const code = `fin-${s.code}-${f.capacityMl}`;
    await tx.insert(t.items).values({ code, name, kind: "finished", stockUnit: "unit" }).onConflictDoNothing({ target: t.items.code });
    const [item] = await tx.select().from(t.items).where(eq(t.items.code, code));
    const [p] = await tx.insert(t.products).values({ sauceId: s.id, formatId: f.id, itemId: item!.id, name }).returning();
    return p!;
  });
}

export async function setProductActive(db: DB, productId: string, active: boolean) {
  await db.update(t.products).set({ active }).where(eq(t.products.id, productId));
}
