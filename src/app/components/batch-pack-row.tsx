"use client";

import { useEffect, useRef, useState } from "react";

export interface PackSize {
  productId: string;
  name: string;
  fillMl: number;
  initialFilled?: string;
  initialRejected?: string;
  /** Jars the run planned to fill in this batch, when known. */
  planned?: number | null;
  /** Where the filled jars go (label), from the product's default storage. */
  storage?: string | null;
  /** Packaging materials used per filled jar. */
  materials: { itemId: string; perJar: number }[];
}

export interface PackStockInfo {
  name: string;
  unit: string;
  available: string;
}

const UNIT_WORD: Record<string, string> = { unit: "units", kg: "kg", L: "L", g: "g", ml: "ml" };

/**
 * The jar sizes of a packaging session: filled and rejected per size, with
 * accepted worked out as you type, and a warning as soon as the jars filled
 * need more jars, lids or labels than are in stock (the save is then held).
 */
export function PackRows({ sizes, stock }: { sizes: PackSize[]; stock: Record<string, PackStockInfo> }) {
  const [values, setValues] = useState(() => sizes.map((s) => ({ filled: s.initialFilled ?? "", rejected: s.initialRejected ?? "" })));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  // Materials needed by everything typed so far (sizes can share a lid or label).
  const need = new Map<string, number>();
  sizes.forEach((s, i) => {
    const f = num(values[i]!.filled);
    if (!Number.isFinite(f) || f <= 0) return;
    for (const m of s.materials) need.set(m.itemId, (need.get(m.itemId) ?? 0) + f * m.perJar);
  });
  const short = new Map<string, { need: number; have: number }>();
  for (const [itemId, n] of need) {
    const have = Number(stock[itemId]?.available ?? 0);
    if (n > have + 1e-9) short.set(itemId, { need: n, have });
  }

  return (
    <>
      {sizes.map((s, i) => {
        const shortHere = s.materials
          .filter((m) => short.has(m.itemId) && num(values[i]!.filled) > 0)
          .map((m) => ({ itemId: m.itemId, ...short.get(m.itemId)! }));
        return (
          <Row
            key={s.productId}
            index={i}
            size={s}
            filled={values[i]!.filled}
            rejected={values[i]!.rejected}
            onChange={(v) => setValues((all) => all.map((x, j) => (j === i ? { ...x, ...v } : x)))}
            short={shortHere.map((x) => {
              const st = stock[x.itemId];
              const u = UNIT_WORD[st?.unit ?? ""] ?? st?.unit ?? "";
              return `Not enough ${st?.name ?? "material"}: ${fmt(x.need)} needed, ${fmt(x.have)} ${u} in stock.`;
            })}
          />
        );
      })}
    </>
  );
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function Row({
  index,
  size,
  filled,
  rejected,
  onChange,
  short,
}: {
  index: number;
  size: PackSize;
  filled: string;
  rejected: string;
  onChange: (v: { filled?: string; rejected?: string }) => void;
  short: string[];
}) {
  const f = filled === "" ? 0 : Number(filled);
  const r = rejected === "" ? 0 : Number(rejected);
  const valid = Number.isInteger(f) && Number.isInteger(r) && f >= 0 && r >= 0 && r <= f;
  const accepted = valid ? f - r : null;
  const filledRef = useRef<HTMLInputElement>(null);
  const message = short.join(" ");
  // Hold the save while materials are short; the server checks the same thing.
  useEffect(() => {
    filledRef.current?.setCustomValidity(message ? `${message} Record the delivery or correct the stock count first.` : "");
  }, [message]);

  return (
    <div className="packrow">
      <input type="hidden" name={`product_${index}`} value={size.productId} />
      <div className="name">
        <strong>{size.name}</strong>
        <div className="small muted">
          {size.fillMl} ml per jar
          {size.planned != null && size.planned > 0 && <> · planned {size.planned}</>}
          {size.storage && <> · kept in: {size.storage}</>}
        </div>
      </div>
      <div>
        <label htmlFor={`filled_${index}`}>Filled</label>
        <input
          ref={filledRef}
          id={`filled_${index}`}
          name={`filled_${index}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={filled}
          onChange={(e) => onChange({ filled: e.target.value })}
          placeholder="0"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `short_${index}` : undefined}
        />
      </div>
      <div>
        <label htmlFor={`rejected_${index}`}>Rejected</label>
        <input
          id={`rejected_${index}`}
          name={`rejected_${index}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={rejected}
          onChange={(e) => onChange({ rejected: e.target.value })}
          placeholder="0"
        />
      </div>
      <div className="acc">
        <span className="small muted">Accepted</span>
        <div className={valid ? "" : "text-bad"}>{accepted === null ? "check the numbers" : accepted}</div>
      </div>
      {message && (
        <p id={`short_${index}`} className="small text-bad" role="status" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {short.map((m) => (
            <span key={m} style={{ display: "block" }}>
              {m}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
