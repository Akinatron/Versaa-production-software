import Link from "next/link";
import Decimal from "decimal.js";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, isUnitCode } from "@/domain/quantity";

/** A quantity in a lot's unit; finished jars are shown as jars (never converted). */
export function lotQty(value: Decimal.Value | null, unit: string, kind?: string) {
  if (value === null) return kind === "finished" ? "unknown jars" : formatQty(null, isUnitCode(unit) ? unit : "unit");
  const d = new Decimal(value);
  if (kind === "finished") return `${d.toString()} jar${d.eq(1) ? "" : "s"}`;
  return formatQty(d, isUnitCode(unit) ? unit : "unit");
}

export const jars = (n: Decimal.Value) => `${new Decimal(n).toString()} jar${new Decimal(n).eq(1) ? "" : "s"}`;

/** Batch codes for a set of batch ids. */
export async function batchCodes(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db().select({ id: t.productionBatches.id, code: t.productionBatches.code }).from(t.productionBatches).where(inArray(t.productionBatches.id, list));
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Where a lot came from, in words: a supplier delivery, a count, or a batch. */
export function LotOrigin({
  lot,
  batchCode,
}: {
  lot: { code: string; supplierName: string | null; deliveryRef: string | null; supplierBatch: string | null; receivedOn: string | null; batchId: string | null };
  batchCode?: string | null;
}) {
  if (lot.batchId) {
    return (
      <>
        From batch <Link href={`/batches/${lot.batchId}`}>{batchCode ?? "(view batch)"}</Link>
      </>
    );
  }
  const parts: string[] = [];
  if (lot.code.startsWith("OPEN-")) parts.push("Opening count");
  else if (lot.code.startsWith("COUNT-")) parts.push("Found during a stock count");
  else parts.push(lot.supplierName ? `Delivery from ${lot.supplierName}` : "Delivery (supplier not recorded)");
  if (lot.deliveryRef) parts.push(`delivery note ${lot.deliveryRef}`);
  if (lot.supplierBatch) parts.push(`supplier batch ${lot.supplierBatch}`);
  return <>{parts.join(" · ")}</>;
}

export function who(customer: string | null | undefined, destination: string | null | undefined) {
  if (customer && destination) return `${customer} (${destination})`;
  return customer || destination || "—";
}

/** Inline style that makes a link look like the primary button. */
export const buttonLink: React.CSSProperties = {
  display: "inline-block",
  background: "var(--accent)",
  color: "#fff",
  borderRadius: 8,
  padding: "10px 18px",
  textDecoration: "none",
};
