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

export const itemKind = pgEnum("item_kind", ["ingredient", "packaging", "finished", "bulk"]);
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
  /** Short code used in batch numbers, e.g. TIK in TIK-20261020-01. */
  batchPrefix: text("batch_prefix"),
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
    /** For bulk sauce and finished jars: the production batch they came from. */
    batchId: uuid("batch_id"),
    createdAt: createdAt(),
  },
  (t) => [index("lots_item").on(t.itemId), index("lots_batch").on(t.batchId)],
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

/**
 * Stock committed to a confirmed run (ingredients, packaging) or a pending
 * sales order (finished jars). Recording use adds a negative row, so the
 * remaining commitment is always the sum.
 */
export const reservations = pgTable("reservations", {
  id: id(),
  runId: uuid("run_id").references(() => productionRuns.id),
  salesOrderId: uuid("sales_order_id"),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Production and packaging ----------

export const batchStatus = pgEnum("batch_status", ["planned", "in_production", "awaiting_packaging", "packing", "closed", "cancelled"]);

export const productionBatches = pgTable(
  "production_batches",
  {
    id: id(),
    code: text("code").notNull().unique(),
    runId: uuid("run_id").notNull().references(() => productionRuns.id),
    sauceId: uuid("sauce_id").notNull().references(() => sauces.id),
    /** The recipe version this batch follows. Never changes once set. */
    recipeVersionId: uuid("recipe_version_id").notNull().references(() => recipeVersions.id),
    seq: integer("seq").notNull(),
    status: batchStatus("status").notNull().default("planned"),
    producedOn: date("produced_on"),
    /** Measured output; either may be unknown. */
    outputLitres: numeric("output_litres"),
    outputKg: numeric("output_kg"),
    bulkLotId: uuid("bulk_lot_id").references(() => lots.id),
    note: text("note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("batches_run").on(t.runId)],
);

/**
 * One row per recipe ingredient of a batch. The actual quantity is the sum
 * of its consumption movements; `confirmedAt` null means still pending,
 * which is different from a confirmed zero.
 */
export const batchConsumption = pgTable(
  "batch_consumption",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => productionBatches.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    /** Recipe quantity for one batch, in the item's stock unit. */
    standardQty: numeric("standard_qty").notNull(),
    /** What the run planned for this batch, in the item's stock unit. */
    plannedQty: numeric("planned_qty").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** Idempotency key of the recording that confirmed it. */
    recordKey: text("record_key"),
    extra: boolean("extra").notNull().default(false),
  },
  (t) => [uniqueIndex("batch_consumption_batch_item").on(t.batchId, t.itemId)],
);

export const packagingSessions = pgTable("packaging_sessions", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => productionBatches.id),
  packedOn: date("packed_on").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  note: text("note"),
  createdAt: createdAt(),
});

export const packagingSessionLines = pgTable("packaging_session_lines", {
  id: id(),
  sessionId: uuid("session_id").notNull().references(() => packagingSessions.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  packagingVersionId: uuid("packaging_version_id").references(() => packagingVersions.id),
  /** Fill per jar at the time, so later format changes don't rewrite history. */
  fillMl: integer("fill_ml").notNull(),
  filled: integer("filled").notNull(),
  rejected: integer("rejected").notNull(),
  accepted: integer("accepted").notNull(),
  finishedLotId: uuid("finished_lot_id").references(() => lots.id),
});

export const incidentType = pgEnum("incident_type", ["loss", "spill", "quality", "other"]);

export const incidents = pgTable("incidents", {
  id: id(),
  batchId: uuid("batch_id").references(() => productionBatches.id),
  lotId: uuid("lot_id").references(() => lots.id),
  type: incidentType("type").notNull(),
  note: text("note").notNull(),
  occurredOn: date("occurred_on").notNull(),
  createdAt: createdAt(),
});

// ---------- Stock corrections ----------

/** A correction, write-off or internal use. Its stock effect is in `movements`. */
export const stockAdjustments = pgTable("stock_adjustments", {
  id: id(),
  type: movementType("type").notNull(),
  reason: text("reason").notNull(),
  occurredOn: date("occurred_on").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
});

// ---------- Sales and other outflows ----------

export const customers = pgTable("customers", {
  id: id(),
  name: text("name").notNull(),
  contact: text("contact"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const salesStatus = pgEnum("sales_status", ["pending", "delivered", "cancelled"]);

export const salesOrders = pgTable("sales_orders", {
  id: id(),
  code: text("code").notNull().unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  destination: text("destination"),
  reference: text("reference"),
  orderedOn: date("ordered_on").notNull(),
  status: salesStatus("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
});

export const salesOrderLines = pgTable("sales_order_lines", {
  id: id(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  jars: integer("jars").notNull(),
  unitPrice: numeric("unit_price"),
});

export const outflowType = pgEnum("outflow_type", ["sale", "sample", "waste", "internal_use"]);

/** Jars actually leaving stock. Only type "sale" counts as sales. */
export const outflows = pgTable("outflows", {
  id: id(),
  code: text("code").notNull().unique(),
  type: outflowType("type").notNull(),
  salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  destination: text("destination"),
  reference: text("reference"),
  note: text("note"),
  occurredOn: date("occurred_on").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
});

export const outflowLines = pgTable("outflow_lines", {
  id: id(),
  outflowId: uuid("outflow_id").notNull().references(() => outflows.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  lotId: uuid("lot_id").notNull().references(() => lots.id),
  jars: integer("jars").notNull(),
  unitPrice: numeric("unit_price"),
});

// ---------- Team logins ----------

export const users = pgTable("users", {
  id: id(),
  /** Stored lower-case. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** A signed-in browser. Only a hash of the cookie token is stored. */
export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
