-- Paperwork: delivery notes (albaranes) on deliveries and invoices on orders,
-- as phone photos or PDFs. The files live in file storage; this table says
-- what each one is and where it belongs. Removing one only marks it removed.
CREATE TYPE "document_kind" AS ENUM ('delivery_note', 'invoice');
--> statement-breakpoint
CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "document_kind" NOT NULL,
  "receipt_id" uuid REFERENCES "receipts"("id"),
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "uploaded_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp with time zone,
  "removed_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "documents_belongs" CHECK (
    ("kind" = 'delivery_note' AND "receipt_id" IS NOT NULL) OR ("kind" = 'invoice' AND "purchase_order_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "documents_receipt" ON "documents" ("receipt_id");
--> statement-breakpoint
CREATE INDEX "documents_po" ON "documents" ("purchase_order_id");
--> statement-breakpoint
CREATE INDEX "documents_supplier" ON "documents" ("supplier_id");
