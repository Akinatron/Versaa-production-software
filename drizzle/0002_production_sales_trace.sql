CREATE TYPE "public"."batch_status" AS ENUM('planned', 'in_production', 'awaiting_packaging', 'packing', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('loss', 'spill', 'quality', 'other');--> statement-breakpoint
CREATE TYPE "public"."outflow_type" AS ENUM('sale', 'sample', 'waste', 'internal_use');--> statement-breakpoint
CREATE TYPE "public"."sales_status" AS ENUM('pending', 'delivered', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."item_kind" ADD VALUE 'bulk';--> statement-breakpoint
CREATE TABLE "batch_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"standard_qty" numeric NOT NULL,
	"planned_qty" numeric NOT NULL,
	"confirmed_at" timestamp with time zone,
	"record_key" text,
	"extra" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid,
	"lot_id" uuid,
	"type" "incident_type" NOT NULL,
	"note" text NOT NULL,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outflow_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outflow_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"jars" integer NOT NULL,
	"unit_price" numeric
);
--> statement-breakpoint
CREATE TABLE "outflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "outflow_type" NOT NULL,
	"sales_order_id" uuid,
	"customer_id" uuid,
	"destination" text,
	"reference" text,
	"note" text,
	"occurred_on" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outflows_code_unique" UNIQUE("code"),
	CONSTRAINT "outflows_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "packaging_session_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"packaging_version_id" uuid,
	"fill_ml" integer NOT NULL,
	"filled" integer NOT NULL,
	"rejected" integer NOT NULL,
	"accepted" integer NOT NULL,
	"finished_lot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "packaging_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"packed_on" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_sessions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"run_id" uuid NOT NULL,
	"sauce_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status" "batch_status" DEFAULT 'planned' NOT NULL,
	"produced_on" date,
	"output_litres" numeric,
	"output_kg" numeric,
	"bulk_lot_id" uuid,
	"note" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_batches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"jars" integer NOT NULL,
	"unit_price" numeric
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid,
	"destination" text,
	"reference" text,
	"ordered_on" date NOT NULL,
	"status" "sales_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "sales_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "movement_type" NOT NULL,
	"reason" text NOT NULL,
	"occurred_on" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lots" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "sales_order_id" uuid;--> statement-breakpoint
ALTER TABLE "sauces" ADD COLUMN "batch_prefix" text;--> statement-breakpoint
ALTER TABLE "batch_consumption" ADD CONSTRAINT "batch_consumption_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_consumption" ADD CONSTRAINT "batch_consumption_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outflow_lines" ADD CONSTRAINT "outflow_lines_outflow_id_outflows_id_fk" FOREIGN KEY ("outflow_id") REFERENCES "public"."outflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outflow_lines" ADD CONSTRAINT "outflow_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outflow_lines" ADD CONSTRAINT "outflow_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outflows" ADD CONSTRAINT "outflows_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outflows" ADD CONSTRAINT "outflows_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_session_lines" ADD CONSTRAINT "packaging_session_lines_session_id_packaging_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."packaging_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_session_lines" ADD CONSTRAINT "packaging_session_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_session_lines" ADD CONSTRAINT "packaging_session_lines_packaging_version_id_packaging_versions_id_fk" FOREIGN KEY ("packaging_version_id") REFERENCES "public"."packaging_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_session_lines" ADD CONSTRAINT "packaging_session_lines_finished_lot_id_lots_id_fk" FOREIGN KEY ("finished_lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_sessions" ADD CONSTRAINT "packaging_sessions_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_sauce_id_sauces_id_fk" FOREIGN KEY ("sauce_id") REFERENCES "public"."sauces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_bulk_lot_id_lots_id_fk" FOREIGN KEY ("bulk_lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_consumption_batch_item" ON "batch_consumption" USING btree ("batch_id","item_id");--> statement-breakpoint
CREATE INDEX "batches_run" ON "production_batches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "lots_batch" ON "lots" USING btree ("batch_id");--> statement-breakpoint
UPDATE "sauces" SET "batch_prefix" = 'TIK' WHERE "code" = 'indiase-tikka-masala' AND "batch_prefix" IS NULL;--> statement-breakpoint
UPDATE "sauces" SET "batch_prefix" = 'BOL' WHERE "code" = 'italiaanse-bolognese' AND "batch_prefix" IS NULL;--> statement-breakpoint
UPDATE "sauces" SET "batch_prefix" = 'KIP' WHERE "code" = 'liberiaanse-kip' AND "batch_prefix" IS NULL;--> statement-breakpoint
-- Recorded packaging results and outflows are history: fix mistakes with new records.
CREATE TRIGGER packaging_session_lines_append_only BEFORE UPDATE OR DELETE ON packaging_session_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint
CREATE TRIGGER outflow_lines_append_only BEFORE UPDATE OR DELETE ON outflow_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
