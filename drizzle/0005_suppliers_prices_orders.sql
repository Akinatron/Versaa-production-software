-- Block A (round 1): supplier ↔ item links with price history, orders linked
-- to runs and starting as drafts, deliveries with accepted/rejected quantities.
CREATE TABLE "supplier_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "rank" integer NOT NULL,
  "supplier_code" text,
  "note" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_items_supplier_item" ON "supplier_items" ("supplier_id", "item_id");
--> statement-breakpoint
CREATE INDEX "supplier_items_item" ON "supplier_items" ("item_id");
--> statement-breakpoint
CREATE TABLE "supplier_item_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_item_id" uuid NOT NULL REFERENCES "supplier_items"("id"),
  "pack_qty" numeric,
  "pack_name" text,
  "price" numeric,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "supplier_item_prices_link" ON "supplier_item_prices" ("supplier_item_id");
--> statement-breakpoint
-- Price history only grows: a new price is a new row.
CREATE TRIGGER supplier_item_prices_append_only BEFORE UPDATE OR DELETE ON supplier_item_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
ALTER TYPE "po_status" ADD VALUE IF NOT EXISTS 'closed';
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "run_id" uuid REFERENCES "production_runs"("id");
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "note" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_idempotency_key_unique" UNIQUE("idempotency_key");
--> statement-breakpoint
CREATE INDEX "purchase_orders_run" ON "purchase_orders" ("run_id");
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "pack_qty" numeric;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "packs" integer;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "pack_price" numeric;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "needed_qty" numeric;
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "received_time" text;
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "note" text;
--> statement-breakpoint
ALTER TABLE "receipt_lines" ALTER COLUMN "lot_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "rejected_qty" numeric DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD COLUMN "damage_note" text;
