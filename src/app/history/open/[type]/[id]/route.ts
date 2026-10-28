import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import type { EntityType } from "@/db/changes";

/** Where each kind of record lives, so a history line can link to any of them. */
async function pathFor(type: EntityType, id: string): Promise<string> {
  const d = db();
  switch (type) {
    case "run":
      return `/runs/${id}`;
    case "batch":
      return `/batches/${id}`;
    case "packaging_session": {
      const [s] = await d.select({ batchId: t.packagingSessions.batchId }).from(t.packagingSessions).where(eq(t.packagingSessions.id, id));
      return s ? `/batches/${s.batchId}/pack` : "/batches";
    }
    case "batch_consumption" as EntityType: {
      const [c] = await d.select({ batchId: t.batchConsumption.batchId }).from(t.batchConsumption).where(eq(t.batchConsumption.id, id));
      return c ? `/batches/${c.batchId}/cook` : "/batches";
    }
    case "incident": {
      const [i] = await d.select().from(t.incidents).where(eq(t.incidents.id, id));
      if (i?.batchId) return `/batches/${i.batchId}/close#incidents`;
      return i?.lotId ? `/trace/lot/${i.lotId}` : "/batches";
    }
    case "purchase_order":
      return `/orders/${id}`;
    case "receipt":
      return `/deliveries/${id}`;
    case "lot":
      return `/trace/lot/${id}`;
    case "item":
      return `/items/${id}`;
    case "supplier":
      return `/suppliers/${id}`;
    case "sales_order":
      return `/outbound/orders/${id}`;
    case "outflow":
      return `/trace/outflow/${id}`;
    case "stock_adjustment":
      return `/stock/adjustments/${id}`;
    case "customer":
      return "/outbound/customers";
    case "sauce":
    case "format":
    case "product":
      return "/settings/catalog";
    case "recipe":
      return `/settings/recipes/${id}`;
    case "packaging_list":
      return `/settings/packaging/${id}`;
    case "yield":
      return "/settings/yields";
    case "document": {
      const [doc] = await d.select().from(t.documents).where(eq(t.documents.id, id));
      if (doc?.receiptId) return `/deliveries/${doc.receiptId}`;
      return doc?.purchaseOrderId ? `/orders/${doc.purchaseOrderId}` : "/deliveries";
    }
    default:
      return "/history";
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const path = /^[0-9a-f-]{36}$/i.test(id) ? await pathFor(type as EntityType, id) : "/history";
  return NextResponse.redirect(new URL(path, req.url));
}
