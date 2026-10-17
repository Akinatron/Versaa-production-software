-- The stock ledger and frozen forecasts can only grow. Mistakes are fixed
-- with new movements (corrections, reversals), never by editing history.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted; record a correction instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER movements_append_only BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER forecast_snapshots_append_only BEFORE UPDATE OR DELETE ON forecast_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER yield_figures_append_only BEFORE UPDATE OR DELETE ON yield_figures
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER reject_figures_append_only BEFORE UPDATE OR DELETE ON reject_figures
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- At most one active version per sauce / per product.
CREATE UNIQUE INDEX recipe_versions_one_active ON recipe_versions (sauce_id) WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX packaging_versions_one_active ON packaging_versions (product_id) WHERE status = 'active';
