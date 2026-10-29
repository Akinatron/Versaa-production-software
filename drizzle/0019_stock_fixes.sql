-- What a run set aside when it was confirmed ("hold") is kept apart from the
-- later changes as its batches use it ("adjust"), so corrections can't make
-- the original amount grow. Existing rows: for each run, the rows written at
-- confirmation (the earliest ones) are holds; everything after is an adjustment.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'hold' NOT NULL;--> statement-breakpoint
UPDATE "reservations" r SET "kind" = 'adjust'
WHERE r."run_id" IS NOT NULL
  AND r."created_at" > (SELECT min(x."created_at") FROM "reservations" x WHERE x."run_id" = r."run_id");
