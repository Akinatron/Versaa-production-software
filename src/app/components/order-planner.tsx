"use client";

import type { ItemKind } from "@/domain/planner";
import { useState } from "react";
import Decimal from "decimal.js";
import { OrderItems } from "./order-items";
import { NumberInput } from "./ui/number-input";
import { typedNumber, wholeNumber } from "@/domain/typed-number";

export interface PlannerOffer {
  supplierId: string;
  supplierName: string;
  rank: number;
  packQty: string | null;
  packName: string | null;
  price: string | null;
  /** The favourite is not in use; this is the cheapest supplier in use. */
  standIn?: boolean;
}

export interface PlannerLine {
  itemId: string;
  name: string;
  kind: ItemKind;
  unitLabel: string;
  wholeUnits: boolean;
  /** Still to order, as a decimal string. */
  missing: string;
  /** Already in draft orders for this run. */
  inDrafts: string;
  offers: PlannerOffer[];
}

const euro = (d: Decimal | null) => (d === null ? "no price" : `${d.toFixed(2)} €`);

/**
 * Step "plan the order": only what's missing, with the favourite supplier
 * preselected and quantities rounded up to whole packs. Shows the orders that
 * will be created, one per supplier. The server recomputes everything.
 */
export function OrderPlanner({
  lines,
  suppliers,
  runId,
  idempotencyKey,
  action,
}: {
  lines: PlannerLine[];
  suppliers: { id: string; name: string }[];
  runId: string | null;
  idempotencyKey: string;
  action: (form: FormData) => void | Promise<void>;
}) {
  const [choice, setChoice] = useState(() =>
    Object.fromEntries(
      lines.map((l) => {
        const fav = [...l.offers].sort((a, b) => a.rank - b.rank)[0];
        return [
          l.itemId,
          {
            supplierId: new Decimal(l.missing).gt(0) ? (fav?.supplierId ?? "") : "",
            amount: "",
          },
        ];
      }),
    ),
  );

  const computed = lines.map((l) => {
    const c = choice[l.itemId]!;
    const offer = l.offers.find((o) => o.supplierId === c.supplierId) ?? null;
    const missing = new Decimal(l.missing);
    const packQty = offer?.packQty ? new Decimal(offer.packQty) : null;
    let packs: number | null = null;
    let quantity: Decimal;
    if (packQty && packQty.gt(0)) {
      packs = c.amount !== "" ? Math.max(0, wholeNumber(c.amount) || 0) : missing.div(packQty).ceil().toNumber();
      quantity = packQty.mul(packs);
    } else {
      const typed = c.amount !== "" ? new Decimal(Math.max(0, typedNumber(c.amount) || 0)) : missing;
      quantity = l.wholeUnits ? typed.ceil() : typed;
    }
    const price = offer?.price != null ? new Decimal(offer.price) : null;
    const cost = price === null ? null : packs !== null ? price.mul(packs) : price.mul(quantity);
    return {
      line: l,
      offer,
      packQty,
      packs,
      quantity,
      cost,
      supplierId: c.supplierId,
    };
  });

  const groups = new Map<string, typeof computed>();
  for (const c of computed) if (c.supplierId && c.quantity.gt(0)) groups.set(c.supplierId, [...(groups.get(c.supplierId) ?? []), c]);
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "?";

  const set = (itemId: string, patch: Partial<{ supplierId: string; amount: string }>) =>
    setChoice((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, ...patch },
    }));

  return (
    <form action={action}>
      <input type="hidden" name="key" value={idempotencyKey} />
      <input type="hidden" name="runId" value={runId ?? ""} />
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Missing</th>
              <th>Supplier</th>
              <th>Order</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {computed.map((c, i) => {
              const l = c.line;
              const others = suppliers.filter((s) => !l.offers.some((o) => o.supplierId === s.id));
              return (
                <tr key={l.itemId}>
                  <td>
                    {l.name}
                    {new Decimal(l.inDrafts).gt(0) && (
                      <div className="small muted">
                        {l.inDrafts} {l.unitLabel} already in draft orders
                      </div>
                    )}
                    <input type="hidden" name={`item_${i}`} value={l.itemId} />
                    <input type="hidden" name={`need_${i}`} value={l.missing} />
                    <input type="hidden" name={`sup_${i}`} value={c.supplierId} />
                    <input type="hidden" name={`packs_${i}`} value={c.packs ?? ""} />
                    <input type="hidden" name={`qty_${i}`} value={c.packs === null ? c.quantity.toString() : ""} />
                  </td>
                  <td className="num">
                    {l.missing} {l.unitLabel}
                  </td>
                  <td>
                    <select
                      value={c.supplierId}
                      onChange={(e) =>
                        set(l.itemId, {
                          supplierId: e.target.value,
                          amount: "",
                        })
                      }
                      aria-label={`Supplier for ${l.name}`}
                    >
                      <option value="">Don't order</option>
                      {[...l.offers]
                        .sort((a, b) => a.rank - b.rank)
                        .map((o) => (
                          <option key={o.supplierId} value={o.supplierId}>
                            {o.supplierName}
                            {o.standIn ? " (cheapest in use)" : o.rank === 1 ? " (favourite)" : ""}
                          </option>
                        ))}
                      {others.length > 0 && (
                        <optgroup label="Other suppliers (no price saved)">
                          {others.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {l.offers.length === 0 && <div className="small muted">No supplier in use is saved for this item.</div>}
                    {l.offers.some((o) => o.standIn) && <div className="small muted">The favourite supplier is not in use.</div>}
                  </td>
                  <td>
                    {c.supplierId && (
                      <div
                        className="row"
                        style={{
                          gap: 6,
                          alignItems: "center",
                          flexWrap: "nowrap",
                        }}
                      >
                        <NumberInput
                          whole={c.packQty !== null}
                          value={c.packs !== null ? String(c.packs) : choice[l.itemId]!.amount !== "" ? choice[l.itemId]!.amount : c.quantity.toString()}
                          onChange={(e) => set(l.itemId, { amount: e.target.value })}
                          aria-label={`Quantity of ${l.name}`}
                          style={{ maxWidth: 90 }}
                        />
                        <span className="small">
                          {c.packQty ? (
                            <>
                              × {c.packQty.toString()} {l.unitLabel} {c.offer?.packName ?? "pack"}
                              <div className="muted">
                                = {c.quantity.toString()} {l.unitLabel}
                              </div>
                            </>
                          ) : (
                            l.unitLabel
                          )}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="num">{c.supplierId && c.quantity.gt(0) ? euro(c.cost) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Quantities are rounded up to whole packs of the chosen supplier. Choose "Don't order" for anything you'll get another way.
        </p>
      </div>

      <h2>Orders that will be created</h2>
      {groups.size === 0 ? (
        <p className="empty">Nothing selected to order.</p>
      ) : (
        <div className="grid">
          {[...groups.entries()].map(([sid, list]) => {
            const total = list.some((c) => c.cost === null) ? null : list.reduce((s, c) => s.plus(c.cost!), new Decimal(0));
            return (
              <div key={sid} className="card" style={{ marginBottom: 0 }}>
                <strong>{supplierName(sid)}</strong>
                <div className="small" style={{ margin: "6px 0" }}>
                  <OrderItems
                    lines={list.map((c) => ({
                      id: c.line.itemId,
                      text: `${c.line.name}: ${c.packs !== null ? `${c.packs} × ${c.packQty!.toString()} ${c.line.unitLabel}` : `${c.quantity.toString()} ${c.line.unitLabel}`}`,
                    }))}
                  />
                </div>
                <span className="small">
                  Total {euro(total)}
                  {total === null && " (some prices missing)"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="savebar">
        <span className="small muted">Saved as drafts. Nothing is sent to suppliers until you mark each order as sent.</span>
        <button type="submit" disabled={groups.size === 0}>
          Create {groups.size === 1 ? "draft order" : `${groups.size} draft orders`}
        </button>
      </div>
    </form>
  );
}
