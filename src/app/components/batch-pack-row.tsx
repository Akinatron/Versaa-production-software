"use client";

import { useState } from "react";

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
    <div className="packrow">
      <input type="hidden" name={`product_${index}`} value={productId} />
      <div className="name">
        <strong>{name}</strong>
        <div className="small muted">{fillMl} ml per jar</div>
      </div>
      <div>
        <label htmlFor={`filled_${index}`}>Filled</label>
        <input
          id={`filled_${index}`}
          name={`filled_${index}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={filled}
          onChange={(e) => setFilled(e.target.value)}
          placeholder="0"
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
          onChange={(e) => setRejected(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="acc">
        <span className="small muted">Accepted</span>
        <div className={valid ? "" : "text-bad"}>{accepted === null ? "check the numbers" : accepted}</div>
      </div>
    </div>
  );
}
