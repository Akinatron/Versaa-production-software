CREATE TABLE "code_counters" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_idempotency_key_unique" UNIQUE("idempotency_key");