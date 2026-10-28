"use client";

import type { ItemKind } from "@/domain/planner";
import { Fragment, useState } from "react";

/*
 * Expandable budget table: parent rows Ingredients, Packaging and Total.
 * Ingredients and Packaging open to one row per item; Total has no children.
 * Data comes pre-formatted from the server (see budgetForTable), so the
 * same table can show the run budget and the batch budget.
 */

export interface BudgetColumn {
  key: string;
  /** Header over the quantity and cost of this column. */
  label: string;
}

export interface BudgetTableRow {
  itemId: string;
  name: string;
  priceText: string;
  priceSource?: string;
  cells: Record<string, { qty: string; cost: string }>;
}

export interface BudgetTableGroup {
  kind: ItemKind;
  rows: BudgetTableRow[];
  totals: Record<string, string>;
}

export interface BudgetTableData {
  columns: BudgetColumn[];
  groups: BudgetTableGroup[];
  total: Record<string, string>;
}

const TITLE = { ingredient: "Ingredients", packaging: "Packaging", other: "Other" } as const;

export function BudgetTable({ data, note }: { data: BudgetTableData; note?: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const parent = { background: "var(--surface-2)", fontWeight: 600 } as const;

  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Price</th>
            {data.columns.map((c) => (
              <Fragment key={c.key}>
                <th className="num">{c.label}: qty</th>
                <th className="num">{c.label}: cost</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <Fragment key={g.kind}>
              <tr style={parent}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => toggle(g.kind)}
                    aria-expanded={!!open[g.kind]}
                    style={{
                      color: "var(--text)",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                    disabled={g.rows.length === 0}
                  >
                    {g.rows.length ? <span className={`chev${open[g.kind] ? " open" : ""}`} /> : null}
                    {TITLE[g.kind]} <span className="muted small">({g.rows.length})</span>
                  </button>
                </td>
                <td></td>
                {data.columns.map((c) => (
                  <Fragment key={c.key}>
                    <td></td>
                    <td className="num">{g.totals[c.key]}</td>
                  </Fragment>
                ))}
              </tr>
              {open[g.kind] &&
                g.rows.map((r) => (
                  <tr key={r.itemId} className="small" style={{ color: "var(--muted)" }}>
                    <td style={{ paddingLeft: 28 }}>{r.name}</td>
                    <td>
                      {r.priceText}
                      {r.priceSource && <div>{r.priceSource}</div>}
                    </td>
                    {data.columns.map((c) => (
                      <Fragment key={c.key}>
                        <td className="num">{r.cells[c.key]?.qty ?? "—"}</td>
                        <td className="num">{r.cells[c.key]?.cost ?? "—"}</td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
            </Fragment>
          ))}
          <tr style={{ ...parent, borderTop: "2px solid var(--border)" }}>
            <td>Total</td>
            <td></td>
            {data.columns.map((c) => (
              <Fragment key={c.key}>
                <td></td>
                <td className="num">{data.total[c.key]}</td>
              </Fragment>
            ))}
          </tr>
        </tbody>
      </table>
      {note && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {note}
        </p>
      )}
    </div>
  );
}
