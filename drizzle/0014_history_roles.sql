-- Roles: viewers only look; editors create, change, delete and restore;
-- admins also manage the team. Everyone who already has an account is an admin.
CREATE TYPE "user_role" AS ENUM ('viewer', 'editor', 'admin');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role" = 'admin';--> statement-breakpoint

-- The change history: one row per thing a person did. Rows only ever get added.
CREATE TYPE "change_action" AS ENUM ('create', 'update', 'delete', 'restore', 'cancel', 'status');--> statement-breakpoint
CREATE TABLE "change_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "user_name" text,
  "action" "change_action" NOT NULL,
  "area" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "entity_code" text,
  "summary" text NOT NULL,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text
);--> statement-breakpoint
CREATE INDEX "change_log_at" ON "change_log" ("at");--> statement-breakpoint
CREATE INDEX "change_log_entity" ON "change_log" ("entity_type", "entity_id");--> statement-breakpoint
-- Every record a change touches, so it shows on each of their pages.
CREATE TABLE "change_log_links" (
  "change_id" uuid NOT NULL REFERENCES "change_log"("id"),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "entity_code" text,
  PRIMARY KEY ("change_id", "entity_type", "entity_id")
);--> statement-breakpoint
CREATE INDEX "change_log_links_entity" ON "change_log_links" ("entity_type", "entity_id");--> statement-breakpoint
CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON change_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint
CREATE TRIGGER change_log_links_append_only BEFORE UPDATE OR DELETE ON change_log_links
  FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint

-- Stock corrections point at the change that caused them.
ALTER TABLE "movements" ADD COLUMN "change_id" uuid;--> statement-breakpoint

-- Records that can now be deleted are only marked; restoring clears the mark.
ALTER TABLE "receipts" ADD COLUMN "deleted_at" timestamp with time zone, ADD COLUMN "deleted_by" uuid REFERENCES "users"("id"), ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "outflows" ADD COLUMN "deleted_at" timestamp with time zone, ADD COLUMN "deleted_by" uuid REFERENCES "users"("id"), ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "deleted_at" timestamp with time zone, ADD COLUMN "deleted_by" uuid REFERENCES "users"("id"), ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "deleted_at" timestamp with time zone, ADD COLUMN "deleted_by" uuid REFERENCES "users"("id"), ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "packaging_sessions" ADD COLUMN "deleted_by" uuid REFERENCES "users"("id");
