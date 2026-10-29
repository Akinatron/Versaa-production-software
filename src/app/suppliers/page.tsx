import Link from "next/link";
import { sqlList } from "@/db/base";
import { PO_OPEN } from "@/domain/status";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { Flash } from "../components/flash";
import { addSupplierAction } from "./actions";
import { PageHeader } from "../components/ui/header";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [suppliers, counts] = await Promise.all([
    db().select().from(t.suppliers).orderBy(asc(t.suppliers.name)),
    db().execute<{
      supplier_id: string;
      items: number;
      favourite: number;
      open_orders: number;
    }>(sql`
      select s.id as supplier_id,
        (select count(*)::int from supplier_items si where si.supplier_id = s.id and si.active) as items,
        (select count(*)::int from supplier_items si where si.supplier_id = s.id and si.active and si.rank = 1) as favourite,
        (select count(*)::int from purchase_orders o where o.supplier_id = s.id and o.status::text in (${sqlList(PO_OPEN)})) as open_orders
      from suppliers s`),
  ]);
  const by = new Map([...counts].map((c) => [c.supplier_id, c]));

  return (
    <>
      <PageHeader title="Suppliers" />
      <Flash params={params} />
      <div className="card scroll">
        {suppliers.length === 0 ? (
          <p className="muted">No suppliers yet. Add the first one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th className="num">Items sold</th>
                <th className="num">Favourite for</th>
                <th className="num">Open orders</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const c = by.get(s.id);
                return (
                  <tr key={s.id} style={s.active ? undefined : { opacity: 0.6 }}>
                    <td>
                      <Link href={`/suppliers/${s.id}`}>{s.name}</Link>
                      {!s.active && <span className="badge neutral">Not in use</span>}
                    </td>
                    <td className="small">{s.contact ?? <span className="muted">—</span>}</td>
                    <td className="num">{c?.items ?? 0}</td>
                    <td className="num">{c?.favourite ?? 0}</td>
                    <td className="num">{c?.open_orders ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <h2>Add a supplier</h2>
      <form action={addSupplierAction} className="card row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="sname">Name (required)</label>
          <input id="sname" name="name" type="text" required />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="scontact">Contact (optional)</label>
          <input id="scontact" name="contact" type="text" />
        </div>
        <button type="submit" className="secondary">
          Add supplier
        </button>
      </form>
    </>
  );
}
