import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/*
 * Data model. Three rules shape it:
 * 1. Stock is never stored as a number to edit. It is the sum of `movements`,
 *    which are append-only. Corrections and undo are new movements.
 * 2. Every physical quantity sits in a `lot`, so every gram can be traced to
 *    where it came from and where it went.
 * 3. Recipes and packaging lists are versioned. Rows used by a batch are
 *    never edited; a change creates a new version.
 *
 * Quantities are numeric (exact decimals), in the item's stock unit.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const itemKind = pgEnum("item_kind", ["ingredient", "packaging", "finished"]);
export const unitCode = pgEnum("unit_code", ["g", "kg", "ml", "L", "unit"]);
export const versionStatus = pgEnum("version_status", ["draft", "active", "retired"]);
export const estimateSource = pgEnum("estimate_source", ["estimate", "observed"]);

// ---------- Catalog (Settings) ----------

export const items = pgTable("items", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: itemKind("kind").notNull(),
  stockUnit: unitCode("stock_unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const sauces = pgTable("sauces", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const formats = pgTable("formats", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  capacityMl: integer("capacity_ml").notNull(),
  /** Product volume put in each jar. Starts equal to capacity; editable. */
  fillMl: integer("fill_ml").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    sauceId: uuid("sauce_id").notNull().references(() => sauces.id),
    formatId: uuid("format_id").notNull().references(() => formats.id),
    /** The finished-jar stock item for this product. */
    itemId: uuid("item_id").notNull().references(() => items.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_sauce_format").on(t.sauceId, t.formatId)],
);

export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: id(),
    sauceId: uuid("sauce_id").notNull().references(() => sauces.id),
    versionNo: integer("version_no").notNull(),
    batchReferenceKg: numeric("batch_reference_kg").notNull(),
    status: versionStatus("status").notNull().default("draft"),
    note: text("note"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recipe_versions_sauce_no").on(t.sauceId, t.versionNo)],
);

export const recipeLines = pgTable("recipe_lines", {
  id: id(),
  recipeVersionId: uuid("recipe_version_id").notNull().references(() => recipeVersions.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity").notNull(),
  unit: unitCode("unit").notNull(),
  position: integer("position").notNull(),
});

export const packagingVersions = pgTable(
  "packaging_versions",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id),
    versionNo: integer("version_no").notNull(),
    status: versionStatus("status").notNull().default("draft"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("packaging_versions_product_no").on(t.productId, t.versionNo)],
);

export const packagingLines = pgTable("packaging_lines", {
  id: id(),
  packagingVersionId: uuid("packaging_version_id").notNull().references(() => packagingVersions.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  perJar: integer("per_jar").notNull(),
});

/** Append-only. The newest row per sauce is the current figure. */
export const yieldFigures = pgTable("yield_figures", {
  id: id(),
  sauceId: uuid("sauce_id").notNull().references(() => sauces.id),
  litresPerBatch: numeric("litres_per_batch").notNull(),
  source: estimateSource("source").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

/** Append-only. The newest row per product is the current figure (0–1). */
export const rejectFigures = pgTable("reject_figures", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id),
  rate: numeric("rate").notNull(),
  source: estimateSource("source").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contact: text("contact"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

// ---------- Stock ----------

export const lots = pgTable(
  "lots",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => items.id),
    code: text("code").notNull().unique(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    deliveryRef: text("delivery_ref"),
    supplierBatch: text("supplier_batch"),
    receivedOn: date("received_on"),
    bestBefore: date("best_before"),
    createdAt: createdAt(),
  },
  (t) => [index("lots_item").on(t.itemId)],
);

export const movementType = pgEnum("movement_type", [
  "opening_balance",
  "receipt",
  "consumption",
  "production_output",
  "packaging_output",
  "sale",
  "sample",
  "waste",
  "internal_use",
  "count_correction",
  "reversal",
]);

/** The stock ledger. Rows are never updated or deleted. */
export const movements = pgTable(
  "movements",
  {
    id: id(),
    lotId: uuid("lot_id").notNull().references(() => lots.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    /** Signed: positive in, negative out. In the item's stock unit. */
    quantity: numeric("quantity").notNull(),
    type: movementType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    docType: text("doc_type"),
    docId: uuid("doc_id"),
    reason: text("reason"),
    /** Makes every recording action safe to retry: the same key never posts twice. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    reversesMovementId: uuid("reverses_movement_id"),
    createdAt: createdAt(),
  },
  (t) => [index("movements_item").on(t.itemId), index("movements_lot").on(t.lotId)],
);

// ---------- Purchasing ----------

export const poStatus = pgEnum("po_status", ["draft", "sent", "partly_received", "received", "cancelled"]);

export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  code: text("code").notNull().unique(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: poStatus("status").notNull().default("draft"),
  orderedOn: date("ordered_on"),
  expectedOn: date("expected_on"),
  reference: text("reference"),
  createdAt: createdAt(),
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: id(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price"),
});

export const receipts = pgTable("receipts", {
  id: id(),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  receivedOn: date("received_on").notNull(),
  deliveryRef: text("delivery_ref"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
});

export const receiptLines = pgTable("receipt_lines", {
  id: id(),
  receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id),
  lotId: uuid("lot_id").notNull().references(() => lots.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity").notNull(),
});

// ---------- Planning ----------

export const runStatus = pgEnum("run_status", ["draft", "confirmed", "in_progress", "closed", "cancelled"]);

export const productionRuns = pgTable("production_runs", {
  id: id(),
  code: text("code").notNull().unique(),
  plannedFor: date("planned_for").notNull(),
  status: runStatus("status").notNull().default("draft"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const runTargets = pgTable(
  "run_targets",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => productionRuns.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    targetJars: integer("target_jars").notNull(),
  },
  (t) => [uniqueIndex("run_targets_run_product").on(t.runId, t.productId)],
);

/** Frozen at confirmation; never updated, so plan vs actual stays comparable. */
export const forecastSnapshots = pgTable("forecast_snapshots", {
  id: id(),
  runId: uuid("run_id").notNull().unique().references(() => productionRuns.id),
  data: jsonb("data").notNull(),
  createdAt: createdAt(),
});

export const reservations = pgTable("reservations", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => productionRuns.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: createdAt(),
});
