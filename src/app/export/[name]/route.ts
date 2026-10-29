import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { toCsv, type Cell } from "../csv";
import { toXlsx, type XlsxType } from "@/lib/xlsx";
import { today } from "@/domain/dates";
import { BUSINESS_TIME_ZONE } from "@/domain/dates";

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Each export: column names, rows, and (for Excel) how to write each column. */
type Export = (range: { from: string; to: string } | null) => Promise<{ header: string[]; rows: Cell[][]; types: XlsxType[] }>;

const T = "text" as const;
const N = "number" as const;
const D = "date" as const;
const DT = "datetime" as const;

const exports: Record<string, Export> = {
  async movements(range) {
    const where: SQL = range ? sql`where (m.occurred_at at time zone ${BUSINESS_TIME_ZONE})::date between ${range.from} and ${range.to}` : sql``;
    const rows = await db().execute<Record<string, Cell>>(sql`
      select to_char(m.occurred_at, 'YYYY-MM-DD') as date, m.type::text as type, i.name as item, i.kind::text as kind, l.code as lot,
        m.quantity::text as quantity, i.stock_unit::text as unit, m.reason, m.doc_type,
        coalesce(b.code, bc_b.code, ps_b.code, o.code, r.delivery_ref, sa.reason) as document,
        case when m.reverses_movement_id is not null then 'yes' else '' end as reverses_earlier,
        to_char(m.created_at, 'YYYY-MM-DD HH24:MI') as recorded_at
      from movements m
      join items i on i.id = m.item_id
      join lots l on l.id = m.lot_id
      left join production_batches b on m.doc_type = 'batch' and b.id = m.doc_id
      left join batch_consumption bc on m.doc_type = 'batch_consumption' and bc.id = m.doc_id
      left join production_batches bc_b on bc_b.id = bc.batch_id
      left join packaging_sessions ps on m.doc_type = 'packaging_session' and ps.id = m.doc_id
      left join production_batches ps_b on ps_b.id = ps.batch_id
      left join outflows o on m.doc_type = 'outflow' and o.id = m.doc_id
      left join receipts r on m.doc_type = 'receipt' and r.id = m.doc_id
      left join stock_adjustments sa on m.doc_type = 'stock_adjustment' and sa.id = m.doc_id
      ${where}
      order by m.occurred_at, m.created_at`);
    return {
      header: ["date", "type", "item", "item kind", "lot", "quantity (+ in, - out)", "unit", "reason", "document type", "document", "reverses an earlier movement", "recorded at"],
      rows: [...rows].map((r) => [r.date, r.type, r.item, r.kind, r.lot, r.quantity, r.unit, r.reason, r.doc_type, r.document, r.reverses_earlier, r.recorded_at]),
      types: [D, T, T, T, T, N, T, T, T, T, T, DT],
    };
  },

  async lots() {
    const rows = await db().execute<Record<string, Cell>>(sql`
      select l.code, i.name as item, i.kind::text as kind, i.stock_unit::text as unit,
        case when b.id is not null then 'batch' when l.supplier_id is not null then 'supplier'
             when exists (select 1 from movements m where m.lot_id = l.id and m.type = 'opening_balance') then 'opening count'
             when exists (select 1 from movements m where m.lot_id = l.id and m.type = 'receipt') then 'delivery'
             else 'stock count' end as origin,
        coalesce(b.code, s.name) as origin_detail, l.delivery_ref, l.supplier_batch, l.received_on::text, l.best_before::text,
        coalesce((select sum(m.quantity) from movements m where m.lot_id = l.id), 0)::text as balance
      from lots l
      join items i on i.id = l.item_id
      left join suppliers s on s.id = l.supplier_id
      left join production_batches b on b.id = l.batch_id
      order by i.kind, i.name, l.created_at`);
    return {
      header: ["lot", "item", "item kind", "unit", "origin", "supplier or batch", "delivery note", "supplier batch", "received/made on", "best before", "balance now"],
      rows: [...rows].map((r) => [r.code, r.item, r.kind, r.unit, r.origin, r.origin_detail, r.delivery_ref, r.supplier_batch, r.received_on, r.best_before, r.balance]),
      types: [T, T, T, T, T, T, T, T, D, D, N],
    };
  },

  async sales(range) {
    const where: SQL = range ? sql`where o.occurred_on between ${range.from} and ${range.to}` : sql``;
    const rows = await db().execute<Record<string, Cell>>(sql`
      select o.code, o.type::text as type, o.occurred_on::text as date, c.name as customer, o.destination, o.reference, so.code as sales_order,
        p.name as product, l.code as lot, b.code as batch, ol.jars, ol.unit_price::text as unit_price,
        (ol.jars * ol.unit_price)::text as line_value, o.note
      from outflow_lines ol
      join outflows o on o.id = ol.outflow_id and o.deleted_at is null
      join products p on p.id = ol.product_id
      join lots l on l.id = ol.lot_id
      left join production_batches b on b.id = l.batch_id
      left join customers c on c.id = o.customer_id
      left join sales_orders so on so.id = o.sales_order_id
      ${where}
      order by o.occurred_on, o.code`);
    return {
      header: ["outflow", "type", "date", "customer", "destination", "reference", "sales order", "product", "lot", "batch", "jars", "unit price (recorded)", "line value (jars x price)", "note"],
      rows: [...rows].map((r) => [r.code, r.type, r.date, r.customer, r.destination, r.reference, r.sales_order, r.product, r.lot, r.batch, r.jars, r.unit_price, r.line_value, r.note]),
      types: [T, T, D, T, T, T, T, T, T, T, N, N, N, T],
    };
  },

  async batches(range) {
    const where: SQL = range ? sql`where coalesce(b.produced_on, r.planned_for) between ${range.from} and ${range.to}` : sql``;
    const rows = await db().execute<Record<string, Cell>>(sql`
      select b.code, s.name as sauce, r.code as run, v.version_no, b.status::text as status, r.planned_for::text as planned_for,
        b.produced_on::text as produced_on, to_char(b.closed_at, 'YYYY-MM-DD') as closed_on,
        (select (sum(l.filled * l.fill_ml) / 1000.0)::text from packaging_sessions ps join packaging_session_lines l on l.session_id = ps.id where ps.batch_id = b.id and ps.deleted_at is null) as litres,
        (select sum(l.filled) from packaging_sessions ps join packaging_session_lines l on l.session_id = ps.id where ps.batch_id = b.id and ps.deleted_at is null)::int as filled,
        (select sum(l.rejected) from packaging_sessions ps join packaging_session_lines l on l.session_id = ps.id where ps.batch_id = b.id and ps.deleted_at is null)::int as rejected,
        (select sum(l.accepted) from packaging_sessions ps join packaging_session_lines l on l.session_id = ps.id where ps.batch_id = b.id and ps.deleted_at is null)::int as accepted,
        b.note
      from production_batches b
      join sauces s on s.id = b.sauce_id
      join production_runs r on r.id = b.run_id
      join recipe_versions v on v.id = b.recipe_version_id
      ${where}
      order by r.planned_for, b.code`);
    return {
      header: ["batch", "sauce", "run", "recipe version", "status", "planned for", "produced on", "closed on", "litres (jars filled x ml, rejects included)", "jars filled", "jars rejected", "jars accepted", "note"],
      rows: [...rows].map((r) => [r.code, r.sauce, r.run, r.version_no, r.status, r.planned_for, r.produced_on, r.closed_on, r.litres, r.filled, r.rejected, r.accepted, r.note]),
      types: [T, T, T, N, T, D, D, D, N, N, N, N, T],
    };
  },
};

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const fn = Object.hasOwn(exports, name) ? exports[name] : undefined;
  if (!fn) return new Response("Unknown export. Available: movements, lots, sales, batches.", { status: 404 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const range = isDate(from) && isDate(to) ? { from, to } : null;
  const { header, rows, types } = await fn(range);
  const stamp = today();
  const excel = url.searchParams.get("format") === "xlsx";
  const file = `versaa-${name}-${range ? `${range.from}-to-${range.to}` : stamp}.${excel ? "xlsx" : "csv"}`;
  const headers = { "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" };
  if (excel) {
    const body = new Uint8Array(toXlsx(name, header, rows, types));
    return new Response(body, { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  }
  return new Response(toCsv(header, rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
