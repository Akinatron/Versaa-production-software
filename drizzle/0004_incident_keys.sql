ALTER TABLE "incidents" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_idempotency_key_unique" UNIQUE("idempotency_key");