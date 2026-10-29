-- Indexes on the columns pages and saves look rows up by. PostgreSQL only
-- indexes primary keys and unique columns by itself, not the columns that
-- point to another table, so without these every lookup reads the whole table.
CREATE INDEX IF NOT EXISTS "movements_doc" ON "movements" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_lines_receipt" ON "receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_lines_po_line" ON "receipt_lines" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_lines_lot" ON "receipt_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_po" ON "purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_run_item" ON "reservations" USING btree ("run_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_sales_order" ON "reservations" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packaging_sessions_batch" ON "packaging_sessions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packaging_session_lines_session" ON "packaging_session_lines" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_lines_order" ON "sales_order_lines" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outflow_lines_outflow" ON "outflow_lines" USING btree ("outflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outflow_lines_lot" ON "outflow_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_log_links_change" ON "change_log_links" USING btree ("change_id");
