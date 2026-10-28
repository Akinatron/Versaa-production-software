-- Shelf life per ingredient and per product (its finished-jar item): how long a
-- new lot keeps from the day it is packed or received. Used to fill in each
-- new lot's best-before; the lot keeps its own date.
CREATE TYPE "shelf_life_unit" AS ENUM ('days', 'weeks', 'months');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shelf_life" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shelf_life_unit" "shelf_life_unit";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_check" CHECK (("shelf_life" IS NULL AND "shelf_life_unit" IS NULL) OR ("shelf_life" BETWEEN 1 AND 3650 AND "shelf_life_unit" IS NOT NULL));
