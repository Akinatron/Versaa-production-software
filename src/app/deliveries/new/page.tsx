import { eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { ItemSelect } from "../../components/item-select";
import { saveDelivery } from "../actions";
import { PageHeader } from "../../components/ui/header";
import { GuardedForm } from "../../components/unsaved-guard";
import { DocFileInput } from "../../components/doc-upload";

export const dynamic = "force-dynamic";

export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, suppliers, openOrders] = await Promise.all([
    loadPlanCatalog(db()),
    db().select().from(t.suppliers),
    db()
      .select({ po: t.purchaseOrders, supplier: t.suppliers.name })
      .from(t.purchaseOrders)
      .innerJoin(t.suppliers, eq(t.purchaseOrders.supplierId, t.suppliers.id))
      .where(inArray(t.purchaseOrders.status, ["sent", "partly_received"])),
  ]);
  const po = openOrders.find((o) => o.po.id === params.po)?.po;
  const poLines = po
    ? await db()
        .select({
          line: t.purchaseOrderLines,
          item: t.items,
          received: sql<string>`(select coalesce(sum(quantity), 0) from receipt_lines r where r.purchase_order_line_id = ${t.purchaseOrderLines.id})`,
        })
        .from(t.purchaseOrderLines)
        .innerJoin(t.items, eq(t.purchaseOrderLines.itemId, t.items.id))
        .where(eq(t.purchaseOrderLines.purchaseOrderId, po.id))
    : [];
  const pending = poLines
    .map((l) => ({
      ...l,
      pending: Decimal.max(0, new Decimal(l.line.quantity).minus(l.received)),
    }))
    .filter((l) => l.pending.gt(0));
  const blanks = po ? 3 : 8;

  return (
    <>
      <PageHeader
        back={{ href: "/deliveries", label: "Deliveries" }}
        title="Record a delivery"
        lead="Enter what actually arrived, even if it differs from the order. Only the accepted quantity goes into stock; refused goods stay pending on the order."
      />
      <Flash params={params} />

      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="po">Which order is it for?</label>
          <select id="po" name="po" defaultValue={po?.id ?? ""}>
            <option value="">No order / not listed</option>
            {openOrders.map((o) => (
              <option key={o.po.id} value={o.po.id}>
                {o.po.code} · {o.supplier}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="secondary">
          {po ? "Change order" : "Load order lines"}
        </button>
      </form>

      <GuardedForm action={saveDelivery}>
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        <input type="hidden" name="po" value={po?.id ?? ""} />
        <div className="card grid">
          <div>
            <label htmlFor="supplierId">Supplier</label>
            <select id="supplierId" name="supplierId" defaultValue={po?.supplierId ?? ""}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="receivedOn">Delivered on (required)</label>
            <input id="receivedOn" name="receivedOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div>
            <label htmlFor="receivedTime">Time (optional)</label>
            <input id="receivedTime" name="receivedTime" type="time" />
          </div>
          <div>
            <label htmlFor="deliveryRef">Delivery note number (optional)</label>
            <input id="deliveryRef" name="deliveryRef" type="text" />
          </div>
          <div>
            <label htmlFor="docs">Delivery note, photo or PDF (optional)</label>
            <DocFileInput id="docs" name="docs" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="note">Note about the delivery (optional)</label>
            <textarea id="note" name="note" rows={2} placeholder="e.g. arrived late, pallet damaged" />
          </div>
        </div>
        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Accepted</th>
                <th>Refused</th>
                <th>Damage / problem</th>
                <th>Supplier batch</th>
                <th>Best before</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((l, i) => (
                <tr key={l.line.id}>
                  <td>
                    {l.item.name}
                    <div className="small muted">
                      Pending {l.pending.toString()} {UNITS[l.item.stockUnit as UnitCode].label}
                    </div>
                    <input type="hidden" name={`item_${i}`} value={l.item.id} />
                    <input type="hidden" name={`pol_${i}`} value={l.line.id} />
                  </td>
                  <td>
                    <input name={`qty_${i}`} type="number" min="0" step="any" defaultValue={l.pending.toString()} aria-label="Quantity accepted" />
                  </td>
                  <td>
                    <input name={`rej_${i}`} type="number" min="0" step="any" aria-label="Quantity refused" />
                  </td>
                  <td>
                    <input name={`dmg_${i}`} type="text" aria-label="Damage or problem" style={{ minWidth: 140 }} />
                  </td>
                  <td>
                    <input name={`batch_${i}`} type="text" aria-label="Supplier batch" />
                  </td>
                  <td>
                    <input name={`bb_${i}`} type="date" aria-label="Best before" />
                  </td>
                </tr>
              ))}
              {Array.from({ length: blanks }, (_, j) => {
                const i = pending.length + j;
                return (
                  <tr key={`b${i}`}>
                    <td>
                      <ItemSelect name={`item_${i}`} items={catalog.items} />
                      <input type="hidden" name={`pol_${i}`} value="" />
                    </td>
                    <td>
                      <input name={`qty_${i}`} type="number" min="0" step="any" aria-label="Quantity accepted" />
                    </td>
                    <td>
                      <input name={`rej_${i}`} type="number" min="0" step="any" aria-label="Quantity refused" />
                    </td>
                    <td>
                      <input name={`dmg_${i}`} type="text" aria-label="Damage or problem" style={{ minWidth: 140 }} />
                    </td>
                    <td>
                      <input name={`batch_${i}`} type="text" aria-label="Supplier batch" />
                    </td>
                    <td>
                      <input name={`bb_${i}`} type="date" aria-label="Best before" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Rows left empty are ignored. Set accepted to 0 for an ordered item that didn't arrive; it stays pending on the order. If something won't come at
            all, close the order from its page.
          </p>
        </div>
        <div className="savebar">
          <button type="submit">Save delivery</button>
        </div>
      </GuardedForm>
    </>
  );
}
