-- Block B (round 1): packaging sessions can be edited and deleted (marked as
-- deleted, never removed), and bulk sauce stock goes away: a batch's litres
-- now always come from the jars filled.
ALTER TABLE "packaging_sessions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packaging_sessions" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "packaging_sessions" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packaging_sessions" ADD COLUMN "change_key" text;--> statement-breakpoint
-- Session lines stay append-only: an edit or delete adds correction lines
-- (the difference, possibly negative) marked with the change's key.
ALTER TABLE "packaging_session_lines" ADD COLUMN "change_key" text;--> statement-breakpoint
-- Any bulk sauce still in stock is written off with a clear reason, so the
-- ledger stays the only source of stock and nothing is edited.
INSERT INTO "movements" ("lot_id", "item_id", "quantity", "type", "occurred_at", "doc_type", "doc_id", "reason", "idempotency_key")
SELECT l.id, l.item_id, -b.balance, 'waste', now(), 'batch', l.batch_id,
  'Bulk sauce stock removed: batch litres now come from the jars filled', 'migration-0008-bulk-' || l.id
FROM "lots" l
JOIN "items" i ON i.id = l.item_id AND i.kind::text = 'bulk'
JOIN (SELECT lot_id, sum(quantity) AS balance FROM "movements" GROUP BY lot_id) b ON b.lot_id = l.id
WHERE b.balance <> 0;
