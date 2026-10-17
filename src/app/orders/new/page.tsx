import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { Flash } from "../../components/flash";
import { ItemSelect } from "../../components/item-select";
import { saveOrder } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, suppliers] = await Promise.all([loadPlanCatalog(db()), db().select().from(t.suppliers).where(eq(t.suppliers.active, true))]);
  const prefill = (params.items ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => {
      const [itemId, qty] = p.split(":");
      return { itemId: itemId!, qty: qty ?? "" };
    });
  const blank = Array.from({ length: Math.max(4, 8 - prefill.length) }, () => ({ itemId: "", qty: "" }));
  const lines = [...prefill, ...blank];

  return (
    <>
      <h1>New purchase order</h1>
      <p className="lead">Record what you've ordered from a supplier. Stock goes up only when you record the delivery.</p>
      <Flash params={params} />
      {suppliers.length === 0 ? (
        <p className="card">
          No suppliers yet. <Link href="/settings#suppliers">Add a supplier</Link> first.
        </p>
      ) : (
        <form action={saveOrder}>
          <input type="hidden" name="key" value={crypto.randomUUID()} />
          <div className="card grid">
            <div>
              <label htmlFor="supplierId">Supplier (required)</label>
              <select id="supplierId" name="supplierId" required defaultValue="">
                <option value="">Choose…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="expectedOn">Expected delivery (optional)</label>
              <input id="expectedOn" name="expectedOn" type="date" />
            </div>
            <div>
              <label htmlFor="reference">Supplier reference (optional)</label>
              <input id="reference" name="reference" type="text" />
            </div>
          </div>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Price per unit (optional)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <ItemSelect name={`item_${i}`} items={catalog.items} defaultValue={l.itemId} />
                    </td>
                    <td>
                      <input name={`qty_${i}`} type="number" min="0" step="any" defaultValue={l.qty} aria-label="Quantity" />
                    </td>
                    <td>
                      <input name={`price_${i}`} type="number" min="0" step="any" aria-label="Price per unit" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {prefill.length > 0 && <p className="small muted">Pre-filled with what the plan still needs. Adjust to pack sizes as needed.</p>}
          </div>
          <button type="submit">Save order</button>
        </form>
      )}
    </>
  );
}
