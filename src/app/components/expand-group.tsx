"use client";

import { useState, type ReactNode } from "react";

export interface Cell {
  content: ReactNode;
  num?: boolean;
}

/** Styles for tables made of ExpandGroup rows. Render once per page. */
export const expandCss = `
tr.exp-parent > td { background: var(--bg); font-weight: 650; }
tr.exp-parent { cursor: pointer; }
tr.exp-parent.static { cursor: default; }
tr.exp-child > td { color: var(--muted); font-size: 0.9rem; }
tr.exp-child > td:first-child { padding-left: 34px; }
button.exp-toggle { background: none; color: var(--text); padding: 0 6px 0 0; font-size: 0.95rem; line-height: 1; }
`;

/**
 * One parent row that opens and closes its child rows (▸ / ▾). Closed by
 * default. A group without children shows the parent only.
 */
export function ExpandGroup({ cells, children, hasChildren = true, defaultOpen = false }: { cells: Cell[]; children?: ReactNode; hasChildren?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => hasChildren && setOpen((o) => !o);
  return (
    <tbody>
      <tr className={`exp-parent${hasChildren ? "" : " static"}`} onClick={toggle}>
        {cells.map((c, i) => (
          <td key={i} className={c.num ? "num" : undefined}>
            {i === 0 && (
              <button
                type="button"
                className="exp-toggle"
                aria-expanded={open}
                aria-label={open ? "Hide details" : "Show details"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                style={{ visibility: hasChildren ? "visible" : "hidden" }}
              >
                {open ? "▾" : "▸"}
              </button>
            )}
            {c.content}
          </td>
        ))}
      </tr>
      {open && children}
    </tbody>
  );
}
