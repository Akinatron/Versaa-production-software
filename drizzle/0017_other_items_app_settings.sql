-- "Other" items: things bought and kept in stock that are neither an
-- ingredient nor packaging (cleaning products, gloves, gas…). They never go
-- in a recipe or a packaging list, so the planner leaves them out.
ALTER TYPE "item_kind" ADD VALUE IF NOT EXISTS 'other';--> statement-breakpoint
-- Small app-wide settings, such as whether developer mode is on.
CREATE TABLE "app_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
