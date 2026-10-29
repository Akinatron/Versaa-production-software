-- Why a batch wasn't made is kept apart from the batch's own note, so marking
-- it as not made (and restoring it) never changes the note.
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "not_made_reason" text;--> statement-breakpoint
-- Batches already marked as not made had the reason written over their note:
-- move it to the new column and bring back the last note from the history.
UPDATE "production_batches" b
SET "not_made_reason" = b."note",
    "note" = (
      SELECT ch->>'after'
      FROM "change_log" c, jsonb_array_elements(c."changes") ch
      WHERE c."entity_type" = 'batch' AND c."entity_id" = b."id" AND c."action" = 'update' AND ch->>'label' = 'Note'
      ORDER BY c."at" DESC
      LIMIT 1
    )
WHERE b."status" = 'cancelled'
  AND b."note" IS NOT NULL
  AND b."note" = (
    SELECT trim(c."reason") FROM "change_log" c
    WHERE c."entity_type" = 'batch' AND c."entity_id" = b."id" AND c."action" = 'cancel'
    ORDER BY c."at" DESC
    LIMIT 1
  );
