"use client";

import { useState } from "react";

const big = { fontSize: "1.15rem", padding: "12px", maxWidth: 140 } as const;

/** One jar size in a packaging session: filled and rejected, with accepted worked out as you type. */
export function BatchPackRow({
  index,
  productId,
  name,
  fillMl,
  initialFilled = "",
  initialRejected = "",
}: {
  index: number;
  productId: string;
  name: string;
  fillMl: number;
  initialFilled?: string;
  initialRejected?: string;
}) {
  const [filled, setFilled] = useState(initialFilled);
  const [rejected, setRejected] = useState(initialRejected);
  const f = filled === "" ? 0 : Number(filled);
  const r = rejected === "" ? 0 : Number(rejected);
  const valid = Number.isInteger(f) && Number.isInteger(r) && f >= 0 && r >= 0 && r <= f;
  const accepted = valid ? f - r : null;
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: "0 0 12px" }}>
      <legend style={{ fontWeight: 600, padding: "0 6px" }}>
        {name} <span className="small muted">({fillMl} ml per jar)</span>
      </legend>
      <input type="hidden" name={`product_${index}`} value={productId} />
      <div className="row">
        <div>
          <label htmlFor={`filled_${index}`}>Jars filled</label>
          <input id={`filled_${index}`} name={`filled_${index}`} type="number" min={0} step={1} inputMode="numeric" style={big} value={filled} onChange={(e) => setFilled(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label htmlFor={`rejected_${index}`}>Jars rejected</label>
          <input id={`rejected_${index}`} name={`rejected_${index}`} type="number" min={0} step={1} inputMode="numeric" style={big} value={rejected} onChange={(e) => setRejected(e.target.value)} placeholder="0" />
        </div>
        <div style={{ paddingBottom: 10 }}>
          <span className="small muted">Accepted (filled − rejected)</span>
          <div style={{ fontSize: "1.3rem", fontWeight: 700 }} className={valid ? "" : "bad"}>
            {accepted === null ? "check the numbers" : `${accepted} jars`}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
