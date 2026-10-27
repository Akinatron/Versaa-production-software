-- Where things are kept: fridge, freezer or room temperature.
-- Each item has a default; each lot keeps its own value, so changing the
-- default later doesn't rewrite where older lots were stored.
CREATE TYPE "storage_place" AS ENUM ('fridge', 'freezer', 'room');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "storage" "storage_place";--> statement-breakpoint
ALTER TABLE "lots" ADD COLUMN "storage" "storage_place";--> statement-breakpoint

-- A new lot takes its item's default unless a value is given.
CREATE FUNCTION "lots_default_storage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."storage" IS NULL THEN
    SELECT i."storage" INTO NEW."storage" FROM "items" i WHERE i."id" = NEW."item_id";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "lots_default_storage" BEFORE INSERT ON "lots" FOR EACH ROW EXECUTE FUNCTION "lots_default_storage"();
