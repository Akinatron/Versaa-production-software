-- One person, one computer: no accounts, sign-in or roles any more.
-- The change history stays (what, when, before and after, why); only "who" goes.

-- History lines about accounts (made, switched off, role or password changed)
-- go with the accounts. The append-only guard is paused just for this.
ALTER TABLE "change_log" DISABLE TRIGGER "change_log_append_only";--> statement-breakpoint
ALTER TABLE "change_log_links" DISABLE TRIGGER "change_log_links_append_only";--> statement-breakpoint
DELETE FROM "change_log_links" WHERE "change_id" IN (SELECT "id" FROM "change_log" WHERE "entity_type" = 'user');--> statement-breakpoint
DELETE FROM "change_log_links" WHERE "entity_type" = 'user';--> statement-breakpoint
DELETE FROM "change_log" WHERE "entity_type" = 'user';--> statement-breakpoint
ALTER TABLE "change_log" ENABLE TRIGGER "change_log_append_only";--> statement-breakpoint
ALTER TABLE "change_log_links" ENABLE TRIGGER "change_log_links_append_only";--> statement-breakpoint

ALTER TABLE "change_log" DROP COLUMN IF EXISTS "user_id", DROP COLUMN IF EXISTS "user_name";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "uploaded_by", DROP COLUMN IF EXISTS "removed_by";--> statement-breakpoint
ALTER TABLE "receipts" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "outflows" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "stock_adjustments" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "packaging_sessions" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint

DROP TABLE IF EXISTS "sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "users";--> statement-breakpoint
DROP TYPE IF EXISTS "user_role";
