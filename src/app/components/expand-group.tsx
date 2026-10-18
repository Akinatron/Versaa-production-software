"use client";

import { useState, type ReactNode } from "react";

export interface Cell {
  content: ReactNode;
  num?: boolean;
}

/**
 * One parent row that opens and closes its child rows (chevron). Closed by
 * default. A group without children shows the parent only.
 */
export function ExpandGroup({
  cells,
  children,
  hasChildren = true,
  defaultOpen = false,
}: {
  cells: Cell[];
  children?: ReactNode;
  hasChildren?: boolean;
  defaultOpen?: boolean;
}) {
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
                <span className={`chev${open ? " open" : ""}`} />
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
