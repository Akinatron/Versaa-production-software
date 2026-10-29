-- What a run set aside when it was confirmed ("hold") is kept apart from the
-- later changes as its batches use it ("adjust"), so corrections can't make
-- the original amount grow. Existing rows: for each run, the rows written at
-- confirmation (the earliest ones) are holds; everything after is an adjustment.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'hold' NOT NULL;--> statement-breakpoint
UPDATE "reservations" r SET "kind" = 'adjust'
WHERE r."run_id" IS NOT NULL
  AND r."created_at" > (SELECT min(x."created_at") FROM "reservations" x WHERE x."run_id" = r."run_id");
--> statement-breakpoint

-- Every product keeps its jars in its own stock item. Before, two sizes with
-- the same ml (e.g. a 250 ml jar and a 250 ml bottle) shared one. If that ever
-- happened, the later product gets a new item of its own; the stock already
-- recorded stays where it is, on the first product's item.
DO $$
DECLARE
  r record;
  new_id uuid;
  base text;
  c text;
  n int;
BEGIN
  FOR r IN
    SELECT p.id, p.name, s.code AS sauce_code, f.code AS format_code, i.storage, i.shelf_life, i.shelf_life_unit
    FROM products p
    JOIN sauces s ON s.id = p.sauce_id
    JOIN formats f ON f.id = p.format_id
    JOIN items i ON i.id = p.item_id
    WHERE EXISTS (SELECT 1 FROM products q WHERE q.item_id = p.item_id AND (q.created_at, q.id::text) < (p.created_at, p.id::text))
  LOOP
    base := 'fin-' || r.sauce_code || '-' || regexp_replace(r.format_code, '^f([0-9])', '\1');
    c := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM items WHERE code = c) LOOP
      n := n + 1;
      c := base || '-' || n;
    END LOOP;
    INSERT INTO items (code, name, kind, stock_unit, storage, shelf_life, shelf_life_unit)
    VALUES (c, r.name, 'finished', 'unit', r.storage, r.shelf_life, r.shelf_life_unit)
    RETURNING id INTO new_id;
    UPDATE products SET item_id = new_id WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_item" ON "products" USING btree ("item_id");
--> statement-breakpoint

-- The desktop app now loads the starting catalog until it is marked as loaded.
-- A database that already has a catalog (or anything else) is marked now, so
-- nothing is loaded into it again.
INSERT INTO "app_settings" ("key", "value")
SELECT 'catalog_loaded', 'true'::jsonb
WHERE EXISTS (SELECT 1 FROM "items") OR EXISTS (SELECT 1 FROM "sauces") OR EXISTS (SELECT 1 FROM "change_log")
ON CONFLICT ("key") DO NOTHING;
