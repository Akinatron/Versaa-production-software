"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface FlowNode {
  id: string;
  label: string;
  sub?: string;
  href?: string;
  /** The lot this page is about. */
  focus?: boolean;
}
export interface FlowColumn {
  key: string;
  title: string;
  nodes: FlowNode[];
  /** Shown when the column has no nodes. */
  empty?: string;
}
export interface FlowEdge {
  from: string;
  to: string;
}

interface Path {
  key: string;
  d: string;
  from: string;
  to: string;
  col: number;
}

/** Everything linked to `id`, walking only backwards (upstream) or only forwards (downstream). */
function reach(id: string, edges: FlowEdge[]) {
  const seen = new Set([id]);
  for (const dir of ["up", "down"] as const) {
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        const next = dir === "down" ? (e.from === cur ? e.to : null) : e.to === cur ? e.from : null;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  return seen;
}

/**
 * The trace as a diagram: one column per step, curved links drawn between the boxes.
 * The links are measured from the real boxes, so the layout follows the screen size.
 * Pointing at (or tabbing to) a box lights up its whole path and fades the rest.
 */
export function TraceFlow({ columns, edges }: { columns: FlowColumn[]; edges: FlowEdge[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hot, setHot] = useState<string | null>(null);

  const colOf = useMemo(() => {
    const m = new Map<string, number>();
    columns.forEach((c, i) => c.nodes.forEach((n) => m.set(n.id, i)));
    return m;
  }, [columns]);

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    // Offsets ignore the boxes' entrance animation (transforms), so links land where the boxes end up.
    const at = (id: string) => el.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
    const next: Path[] = [];
    for (const e of edges) {
      const a = at(e.from);
      const b = at(e.to);
      if (!a || !b) continue;
      const x1 = a.offsetLeft + a.offsetWidth;
      const y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft;
      const y2 = b.offsetTop + b.offsetHeight / 2;
      const bend = Math.max(24, (x2 - x1) / 2);
      next.push({
        key: `${e.from}>${e.to}`,
        d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`,
        from: e.from,
        to: e.to,
        col: colOf.get(e.from) ?? 0,
      });
    }
    setPaths(next);
    setSize({ w: el.scrollWidth, h: el.scrollHeight });
  }, [edges, colOf]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const lit = useMemo(() => (hot ? reach(hot, edges) : null), [hot, edges]);
  const on = (id: string) => ({
    onMouseEnter: () => setHot(id),
    onMouseLeave: () => setHot(null),
    onFocus: () => setHot(id),
    onBlur: () => setHot(null),
  });

  return (
    <div className={`flow${lit ? " has-hot" : ""}`} ref={wrap} style={{ ["--cols" as string]: columns.length }}>
      <svg className="flow-links" width={size.w} height={size.h} aria-hidden="true">
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            pathLength={1}
            className={lit && lit.has(p.from) && lit.has(p.to) ? "hot" : undefined}
            style={{ ["--i" as string]: p.col }}
          />
        ))}
      </svg>
      {columns.map((c, i) => (
        <section key={c.key} className="flow-col" style={{ ["--i" as string]: i }} aria-label={c.title}>
          <h3>{c.title}</h3>
          {c.nodes.length === 0 && <p className="flow-empty">{c.empty ?? "None"}</p>}
          {c.nodes.map((n, j) => {
            const cls = `flow-node${n.focus ? " focus" : ""}${lit?.has(n.id) ? " hot" : ""}`;
            const body = (
              <>
                <strong>{n.label}</strong>
                {n.sub && <span>{n.sub}</span>}
              </>
            );
            const props = { "data-node": n.id, className: cls, style: { ["--j" as string]: Math.min(j, 8) }, ...on(n.id) };
            return n.href ? (
              <Link key={n.id} href={n.href} {...props}>
                {body}
              </Link>
            ) : (
              <div key={n.id} tabIndex={0} {...props}>
                {body}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
