"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface SearchEntry {
  href: string;
  title: string;
  /** Guide, Question or Term. */
  kind: string;
  sub: string;
  /** Everything searchable, lower case. */
  text: string;
}

/** Search all guides, questions and terms as you type; every word must match. */
export function HelpSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return entries
      .filter((e) => words.every((w) => e.text.includes(w)))
      .map((e) => ({ e, score: words.filter((w) => e.title.toLowerCase().includes(w)).length * 2 + (e.kind === "Guide" ? 1 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.e);
  }, [q, entries]);

  return (
    <div className="help-search">
      <label htmlFor="help-q" className="sr-only">
        Search help
      </label>
      <input
        id="help-q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search help: e.g. refused delivery, best-before, change a recipe"
        autoComplete="off"
        autoFocus
      />
      {words.length > 0 && (
        <div className="card linklist help-results" role="region" aria-live="polite" aria-label="Search results">
          {results.length === 0 ? (
            <p className="muted" style={{ margin: 0, padding: "14px 18px" }}>
              Nothing found for “{q.trim()}”. Try another word, or browse the guides below.
            </p>
          ) : (
            results.map((r) => (
              <Link key={r.href} href={r.href}>
                <span className="badge neutral">{r.kind}</span>
                <span className="what">
                  <span>{r.title}</span>
                  <span className="sub">{r.sub}</span>
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
