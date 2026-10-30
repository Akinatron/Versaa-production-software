"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clampInt, labelPages } from "@/domain/label-sheet";
import { Barcode } from "./barcode";
import { PrintButton } from "./print-button";
import { NumberInput } from "./ui/number-input";

export type SheetFormat = { name: string; cols: number; rows: number; w: number; h: number };

export function JarLabel({ name, code, bestBefore }: { name: string; code: string; bestBefore: string }) {
  return (
    <div className="jar-label">
      <div className="jl-name">{name}</div>
      <div className="jl-line">Lot {code}</div>
      <div className="jl-line">Best before {bestBefore}</div>
      <Barcode value={code} className="jl-bars" />
    </div>
  );
}

/** The label form and the A4 sheets. The sheets follow the form as you type; the URL keeps the choice so a reload shows the same. */
export function LabelSheets({
  name,
  code,
  bestBefore,
  sheet,
  initialCount,
  initialStart,
  singleHref,
}: {
  name: string;
  code: string;
  bestBefore: string;
  sheet: SheetFormat;
  initialCount: number;
  initialStart: number;
  singleHref: string;
}) {
  const perSheet = sheet.cols * sheet.rows;
  const [countText, setCountText] = useState(String(initialCount));
  const [startText, setStartText] = useState(String(initialStart));
  const count = clampInt(countText, 1, 2000, 1);
  const start = clampInt(startText, 1, perSheet, 1);
  const pages = labelPages(count, start, perSheet);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("count", String(count));
    url.searchParams.set("start", String(start));
    window.history.replaceState(window.history.state, "", url);
  }, [count, start]);

  const label = <JarLabel name={name} code={code} bestBefore={bestBefore} />;
  const pickStart = (pos: number) => setStartText(String(pos));

  return (
    <>
      <div className="no-print card row" style={{ alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <label htmlFor="count">Labels</label>
          <NumberInput
            whole
            id="count"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={() => setCountText(String(count))}
            style={{ width: 100 }}
          />
        </div>
        <div>
          <label htmlFor="start">Start at position</label>
          <NumberInput
            whole
            id="start"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => setStartText(String(start))}
            style={{ width: 100 }}
          />
        </div>
        <div>
          <label>Sheet</label>
          <div className="small" style={{ padding: "8px 0" }}>
            {sheet.name}
          </div>
        </div>
        <PrintButton label="Print or save as PDF" />
        <Link href={singleHref} className="btn secondary">
          Download one label
        </Link>
        <p className="small muted" style={{ flexBasis: "100%", margin: 0 }} aria-live="polite">
          {count} {count === 1 ? "label" : "labels"} on {pages.length} {pages.length === 1 ? "sheet" : "sheets"}, starting at position {start}. Print at 100%
          scale with no margins so the labels line up with the sheet. Using a sheet that is partly used? Click the first free sticker on the sheet below, or
          type its position (counted left to right, top to bottom).
        </p>
      </div>
      {pages.map((p, i) => (
        <div className={i === 0 ? "label-sheet pickable" : "label-sheet"} key={i}>
          {p.map((c, j) => (
            <div className="label-cell" key={j}>
              {i === 0 ? (
                <button
                  type="button"
                  className="label-pick"
                  onClick={() => pickStart(j + 1)}
                  title={`Start at position ${j + 1}`}
                  aria-label={`Start at position ${j + 1}`}
                >
                  {c ? label : <span className="label-pos">{j + 1}</span>}
                </button>
              ) : c ? (
                label
              ) : null}
            </div>
          ))}
          {i === 0 &&
            Array.from({ length: perSheet - p.length }, (_, k) => {
              // Free cells at the end of the first sheet can be picked too.
              const pos = p.length + k + 1;
              return (
                <div className="label-cell" key={`free-${pos}`}>
                  <button
                    type="button"
                    className="label-pick"
                    onClick={() => pickStart(pos)}
                    title={`Start at position ${pos}`}
                    aria-label={`Start at position ${pos}`}
                  >
                    <span className="label-pos">{pos}</span>
                  </button>
                </div>
              );
            })}
        </div>
      ))}
    </>
  );
}
