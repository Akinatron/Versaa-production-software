import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, type Tx } from "./base";
import { diff, logChange, type FieldChange } from "./changes";
import { batchPrefixFor } from "@/domain/codes";
import { isSauceColor, nextSauceColor } from "@/domain/sauce-colors";
import { dimensionOf, isUnitCode, type UnitCode } from "@/domain/quantity";
import { slug } from "@/domain/seed-catalog";
import { parseStorage, storageLabel } from "@/domain/storage";
import { isBoughtKind, KIND_CODE_PREFIX, type BoughtKind } from "@/domain/item-kinds";
import { parseShelfLife, shelfLifeLabel, shelfLifeOf } from "@/domain/shelf-life";

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
        await tx
          .insert(t.recipeLines)
          .values(lines.map((l) => ({ recipeVersionId: v!.id, itemId: l.itemId, quantity: l.quantity, unit: l.unit, position: l.position })));
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
    await tx
      .update(t.recipeVersions)
      .set({ batchReferenceKg: ref.toString(), note: input.note?.trim() || null })
      .where(eq(t.recipeVersions.id, v.id));
  });
}

/** Make a draft the recipe used from now on. The previous version is retired, never edited. */
export async function activateRecipeDraft(db: DB, versionId: string) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(t.recipeVersions).where(eq(t.recipeVersions.id, versionId));
    if (!v || v.status !== "draft") throw new OperationError("Only a draft can be activated.");
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t.recipeLines)
      .where(eq(t.recipeLines.recipeVersionId, v.id));
    if (n === 0) throw new OperationError("A recipe needs at least one ingredient.");
    const [prev] = await tx
      .select()
      .from(t.recipeVersions)
      .where(and(eq(t.recipeVersions.sauceId, v.sauceId), eq(t.recipeVersions.status, "active")));
    await tx
      .update(t.recipeVersions)
      .set({ status: "retired" })
      .where(and(eq(t.recipeVersions.sauceId, v.sauceId), eq(t.recipeVersions.status, "active")));
    await tx.update(t.recipeVersions).set({ status: "active", activatedAt: new Date() }).where(eq(t.recipeVersions.id, v.id));
    const [sauce] = await tx.select().from(t.sauces).where(eq(t.sauces.id, v.sauceId));
    const lineText = async (versionId: string | undefined) => {
      if (!versionId) return new Map<string, string>();
      const rows = await tx
        .select({ name: t.items.name, quantity: t.recipeLines.quantity, unit: t.recipeLines.unit })
        .from(t.recipeLines)
        .innerJoin(t.items, eq(t.recipeLines.itemId, t.items.id))
        .where(eq(t.recipeLines.recipeVersionId, versionId));
      return new Map(rows.map((r) => [r.name, `${new Decimal(r.quantity)} ${r.unit}`]));
    };
    const changes = versionChanges(await lineText(prev?.id), await lineText(v.id));
    if (prev && !new Decimal(prev.batchReferenceKg).eq(v.batchReferenceKg))
      changes.unshift({ label: "Batch size", before: `${new Decimal(prev.batchReferenceKg)} kg`, after: `${new Decimal(v.batchReferenceKg)} kg` });
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "recipe", id: v.sauceId, code: sauce?.name },
      summary: `Recipe v${v.versionNo} of ${sauce?.name ?? "sauce"} made active${prev ? ` (was v${prev.versionNo})` : ""}`,
      changes,
      reason: v.note,
      links: [{ type: "sauce", id: v.sauceId, code: sauce?.name }],
    });
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
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t.packagingLines)
      .where(eq(t.packagingLines.packagingVersionId, v.id));
    if (n === 0) throw new OperationError("A packaging list needs at least one item.");
    const [prev] = await tx
      .select()
      .from(t.packagingVersions)
      .where(and(eq(t.packagingVersions.productId, v.productId), eq(t.packagingVersions.status, "active")));
    await tx
      .update(t.packagingVersions)
      .set({ status: "retired" })
      .where(and(eq(t.packagingVersions.productId, v.productId), eq(t.packagingVersions.status, "active")));
    await tx.update(t.packagingVersions).set({ status: "active", activatedAt: new Date() }).where(eq(t.packagingVersions.id, v.id));
    const [product] = await tx.select().from(t.products).where(eq(t.products.id, v.productId));
    const lineText = async (versionId: string | undefined) => {
      if (!versionId) return new Map<string, string>();
      const rows = await tx
        .select({ name: t.items.name, perJar: t.packagingLines.perJar })
        .from(t.packagingLines)
        .innerJoin(t.items, eq(t.packagingLines.itemId, t.items.id))
        .where(eq(t.packagingLines.packagingVersionId, versionId));
      return new Map(rows.map((r) => [r.name, `${r.perJar} per jar`]));
    };
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "packaging_list", id: v.productId, code: product?.name },
      summary: `Packaging list v${v.versionNo} of ${product?.name ?? "product"} made active${prev ? ` (was v${prev.versionNo})` : ""}`,
      changes: versionChanges(await lineText(prev?.id), await lineText(v.id)),
      links: [{ type: "product", id: v.productId, code: product?.name }],
    });
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

/** Lines added, removed or changed between two versions, by name. */
function versionChanges(before: Map<string, string>, after: Map<string, string>): FieldChange[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.map((n) => ({ label: n, before: before.get(n) ?? null, after: after.get(n) ?? null })).filter((c) => c.before !== c.after);
}

// ---------------------------------------------------------------- items, sauces, sizes, products

async function uniqueCode(db: DB, base: string, table: typeof t.items | typeof t.sauces | typeof t.formats) {
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
    if (!row) return code;
  }
}

export async function addItem(db: DB, input: { kind: BoughtKind; name: string; stockUnit: string; storage?: string | null }) {
  const name = input.name.trim();
  if (!isBoughtKind(input.kind)) throw new OperationError("Choose Ingredient, Packaging or Other.");
  const storage = input.kind === "ingredient" ? parseStorage(input.storage) : null;
  if (storage === "invalid") throw new OperationError("Choose Fridge, Freezer or Room temperature.");
  if (!name) throw new OperationError("Name is required.");
  if (!isUnitCode(input.stockUnit)) throw new OperationError("Choose a stock unit.");
  if (input.kind === "packaging" && input.stockUnit !== "unit") throw new OperationError("Packaging is counted in units.");
  const [dup] = await db
    .select()
    .from(t.items)
    .where(and(sql`lower(${t.items.name}) = lower(${name})`, eq(t.items.kind, input.kind)));
  if (dup) throw new OperationError(`${dup.name} already exists.`);
  const code = await uniqueCode(db, `${KIND_CODE_PREFIX[input.kind]}-${slug(name)}`, t.items);
  const [row] = await db.insert(t.items).values({ code, name, kind: input.kind, stockUnit: input.stockUnit, storage }).returning();
  await logChange(db, {
    action: "create",
    area: "settings",
    entity: { type: "item", id: row!.id, code: name },
    summary: `Added ${input.kind === "other" ? "other item" : input.kind} ${name} (${input.stockUnit}${storage ? `, ${storageLabel(storage).toLowerCase()}` : ""})`,
  });
  return row!;
}

export async function renameItem(db: DB, itemId: string, name: string) {
  if (!name.trim()) throw new OperationError("Name is required.");
  const [item] = await db.select().from(t.items).where(eq(t.items.id, itemId));
  if (!item) throw new OperationError("Item not found.");
  if (item.name === name.trim()) return;
  await db.update(t.items).set({ name: name.trim() }).where(eq(t.items.id, itemId));
  await logChange(db, {
    action: "update",
    area: "settings",
    entity: { type: "item", id: itemId, code: name.trim() },
    summary: `Renamed ${item.name} to ${name.trim()}`,
    changes: diff([["Name", item.name, name.trim()]]),
  });
}

/**
 * Set where an item is kept by default. New lots take this value. Lots that
 * had no value yet (made before it was set) take it too; lots that already
 * say where they are keep theirs, so history isn't rewritten.
 */
export async function setItemStorage(db: DB, itemId: string, value: string | null) {
  const storage = parseStorage(value);
  if (storage === "invalid") throw new OperationError("Choose Fridge, Freezer or Room temperature.");
  const [item] = await db.select().from(t.items).where(eq(t.items.id, itemId));
  if (!item) throw new OperationError("Item not found.");
  if (item.kind === "packaging") throw new OperationError("Packaging items don't have a storage place.");
  if (item.kind === "other") throw new OperationError("Other items don't have a storage place.");
  if (item.storage === storage) return;
  await db.transaction(async (tx) => {
    await tx.update(t.items).set({ storage }).where(eq(t.items.id, itemId));
    if (storage)
      await tx
        .update(t.lots)
        .set({ storage })
        .where(and(eq(t.lots.itemId, itemId), sql`${t.lots.storage} is null`));
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "item", id: itemId, code: item.name },
      summary: `Storage of ${item.name} set to ${storageLabel(storage)}`,
      changes: diff([["Storage", storageLabel(item.storage), storageLabel(storage)]]),
    });
  });
}

/**
 * Set an ingredient's or a finished jar's shelf life (empty clears it). Only
 * new lots use it: lots already made keep their best-before.
 */
export async function setItemShelfLife(db: DB, itemId: string, value: string | null, unit: string | null) {
  const shelf = parseShelfLife(value, unit);
  if (shelf === "invalid") throw new OperationError("Enter the shelf life as a whole number of days, weeks or months (1 to 3650), or leave it empty.");
  const [item] = await db.select().from(t.items).where(eq(t.items.id, itemId));
  if (!item) throw new OperationError("Item not found.");
  if (item.kind === "packaging" || item.kind === "bulk" || item.kind === "other")
    throw new OperationError("Only ingredients and filled jars have a shelf life.");
  const before = shelfLifeOf(item);
  if (shelfLifeLabel(before) === shelfLifeLabel(shelf)) return;
  await db.transaction(async (tx) => {
    await tx
      .update(t.items)
      .set({ shelfLife: shelf?.value ?? null, shelfLifeUnit: shelf?.unit ?? null })
      .where(eq(t.items.id, itemId));
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "item", id: itemId, code: item.name },
      summary: `Shelf life of ${item.name} set to ${shelfLifeLabel(shelf).toLowerCase()}`,
      changes: diff([["Shelf life", shelfLifeLabel(before), shelfLifeLabel(shelf)]]),
    });
  });
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
  const [item] = await db.update(t.items).set({ active }).where(eq(t.items.id, itemId)).returning();
  if (item) await logActive(db, { type: "item", id: item.id, code: item.name }, active);
}

export async function addSauce(db: DB, input: { name: string; batchPrefix?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Name is required.");
  const code = await uniqueCode(db, slug(name), t.sauces);
  const prefix = (input.batchPrefix?.trim() || batchPrefixFor(name)).toUpperCase().slice(0, 5);
  const used = (await db.select({ color: t.sauces.color }).from(t.sauces)).map((r) => r.color);
  const [row] = await db
    .insert(t.sauces)
    .values({ code, name, batchPrefix: prefix, color: nextSauceColor(used) })
    .returning();
  await logChange(db, {
    action: "create",
    area: "settings",
    entity: { type: "sauce", id: row!.id, code: name },
    summary: `Added sauce ${name} (batch codes ${prefix}-…)`,
  });
  return row!;
}

export async function setSauceColor(db: DB, sauceId: string, color: string) {
  if (!isSauceColor(color)) throw new OperationError("Choose one of the listed colours.");
  const [s] = await db.select().from(t.sauces).where(eq(t.sauces.id, sauceId));
  if (!s || s.color === color) return;
  await db.update(t.sauces).set({ color }).where(eq(t.sauces.id, sauceId));
  await logChange(db, {
    action: "update",
    area: "settings",
    entity: { type: "sauce", id: s.id, code: s.name },
    summary: `Colour of ${s.name} changed`,
    changes: diff([["Colour", s.color, color]]),
  });
}

export async function setSauceActive(db: DB, sauceId: string, active: boolean) {
  const [s] = await db.update(t.sauces).set({ active }).where(eq(t.sauces.id, sauceId)).returning();
  if (s) await logActive(db, { type: "sauce", id: s.id, code: s.name }, active);
}

export async function addFormat(db: DB, input: { name: string; capacityMl: number; fillMl?: number | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Name is required.");
  if (!Number.isInteger(input.capacityMl) || input.capacityMl <= 0) throw new OperationError("Capacity must be a whole number of ml.");
  const fill = input.fillMl ?? input.capacityMl;
  if (!Number.isInteger(fill) || fill <= 0 || fill > input.capacityMl) throw new OperationError("Fill must be between 1 ml and the capacity.");
  const code = await uniqueCode(db, `f${input.capacityMl}`, t.formats);
  const [row] = await db.insert(t.formats).values({ code, name, capacityMl: input.capacityMl, fillMl: fill }).returning();
  await logChange(db, {
    action: "create",
    area: "settings",
    entity: { type: "format", id: row!.id, code: name },
    summary: `Added size ${name} (${input.capacityMl} ml, filled to ${fill} ml)`,
  });
  return row!;
}

/** Change how much goes in each jar from now on. Past packaging keeps the fill it used. */
export async function setFormatFill(db: DB, formatId: string, fillMl: number) {
  const [f] = await db.select().from(t.formats).where(eq(t.formats.id, formatId));
  if (!f) throw new OperationError("Size not found.");
  if (!Number.isInteger(fillMl) || fillMl <= 0 || fillMl > f.capacityMl) throw new OperationError(`Fill must be between 1 and ${f.capacityMl} ml.`);
  if (f.fillMl === fillMl) return;
  await db.update(t.formats).set({ fillMl }).where(eq(t.formats.id, formatId));
  await logChange(db, {
    action: "update",
    area: "settings",
    entity: { type: "format", id: f.id, code: f.name },
    summary: `Fill of ${f.name} changed`,
    changes: diff([["Fill", `${f.fillMl} ml`, `${fillMl} ml`]]),
  });
}

export async function setFormatActive(db: DB, formatId: string, active: boolean) {
  const [f] = await db.update(t.formats).set({ active }).where(eq(t.formats.id, formatId)).returning();
  if (f) await logActive(db, { type: "format", id: f.id, code: f.name }, active);
}

/** A new sellable product (sauce × size). Give it a packaging list before planning it. */
export async function addProduct(db: DB, input: { sauceId: string; formatId: string }) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.sauces).where(eq(t.sauces.id, input.sauceId));
    const [f] = await tx.select().from(t.formats).where(eq(t.formats.id, input.formatId));
    if (!s || !f) throw new OperationError("Choose a sauce and a size.");
    const [dup] = await tx
      .select()
      .from(t.products)
      .where(and(eq(t.products.sauceId, s.id), eq(t.products.formatId, f.id)));
    if (dup) {
      if (!dup.active) {
        await tx.update(t.products).set({ active: true }).where(eq(t.products.id, dup.id));
        await logActive(tx, { type: "product", id: dup.id, code: dup.name }, true);
      }
      return dup;
    }
    const name = `${s.name} ${f.name}`;
    const code = `fin-${s.code}-${f.capacityMl}`;
    await tx.insert(t.items).values({ code, name, kind: "finished", stockUnit: "unit" }).onConflictDoNothing({ target: t.items.code });
    const [item] = await tx.select().from(t.items).where(eq(t.items.code, code));
    const [p] = await tx.insert(t.products).values({ sauceId: s.id, formatId: f.id, itemId: item!.id, name }).returning();
    await logChange(tx, { action: "create", area: "settings", entity: { type: "product", id: p!.id, code: name }, summary: `Added product ${name}` });
    return p!;
  });
}

export async function setProductActive(db: DB, productId: string, active: boolean) {
  const [p] = await db.update(t.products).set({ active }).where(eq(t.products.id, productId)).returning();
  if (p) await logActive(db, { type: "product", id: p.id, code: p.name }, active);
}

async function logActive(db: DB | Tx, entity: { type: "item" | "sauce" | "format" | "product"; id: string; code: string }, active: boolean) {
  await logChange(db, {
    action: "status",
    area: "settings",
    entity,
    summary: active ? `${entity.code} back in use` : `${entity.code} marked as not in use`,
    changes: diff([["In use", active ? "No" : "Yes", active ? "Yes" : "No"]]),
  });
}

// ---------------------------------------------------------------- yields and reject rates

/** A new estimate of litres per batch. Earlier figures stay; the newest one is used. */
export async function addYieldFigure(db: DB, input: { sauceId: string; litresPerBatch: number; note?: string | null }) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(t.sauces).where(eq(t.sauces.id, input.sauceId));
    if (!s) throw new OperationError("Sauce not found.");
    const [prev] = await tx
      .select()
      .from(t.yieldFigures)
      .where(eq(t.yieldFigures.sauceId, s.id))
      .orderBy(sql`${t.yieldFigures.createdAt} desc`)
      .limit(1);
    await tx.insert(t.yieldFigures).values({ sauceId: s.id, litresPerBatch: String(input.litresPerBatch), source: "estimate", note: input.note || null });
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "yield", id: s.id, code: s.name },
      summary: `Litres per batch of ${s.name} estimated`,
      changes: diff([["Litres per batch", prev ? `${new Decimal(prev.litresPerBatch)} L` : null, `${input.litresPerBatch} L`]]),
      reason: input.note,
      links: [{ type: "sauce", id: s.id, code: s.name }],
    });
  });
}

/** A new estimate of the reject rate for a product. */
export async function addRejectFigure(db: DB, input: { productId: string; percent: number; note?: string | null }) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(t.products).where(eq(t.products.id, input.productId));
    if (!p) throw new OperationError("Product not found.");
    const [prev] = await tx
      .select()
      .from(t.rejectFigures)
      .where(eq(t.rejectFigures.productId, p.id))
      .orderBy(sql`${t.rejectFigures.createdAt} desc`)
      .limit(1);
    await tx.insert(t.rejectFigures).values({ productId: p.id, rate: String(input.percent / 100), source: "estimate", note: input.note || null });
    await logChange(tx, {
      action: "update",
      area: "settings",
      entity: { type: "yield", id: p.id, code: p.name },
      summary: `Reject rate of ${p.name} estimated`,
      changes: diff([["Rejects", prev ? `${new Decimal(prev.rate).mul(100)}%` : null, `${input.percent}%`]]),
      reason: input.note,
      links: [{ type: "product", id: p.id, code: p.name }],
    });
  });
}

/** Colour of every sauce, by sauce id and by product id, for showing the sauce dot next to names. */
export async function sauceColorMaps(db: DB) {
  const rows = await db
    .select({ sauceId: t.sauces.id, color: t.sauces.color, productId: t.products.id })
    .from(t.sauces)
    .leftJoin(t.products, eq(t.products.sauceId, t.sauces.id));
  const bySauce = new Map<string, string>();
  const byProduct = new Map<string, string>();
  for (const r of rows) {
    bySauce.set(r.sauceId, r.color);
    if (r.productId) byProduct.set(r.productId, r.color);
  }
  return { bySauce, byProduct };
}
