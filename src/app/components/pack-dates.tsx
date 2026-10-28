"use client";

import { useState } from "react";
import { bestBeforeFrom, shelfLifeLabel, type ShelfLife } from "@/domain/shelf-life";
import { fmtDate } from "./ui/format";

type Size = { name: string; shelf: ShelfLife | null };

/**
 * "Packed on" and "Best-before" for a new packaging session. When every size
 * has the same shelf life, best-before is filled in (packing date + shelf
 * life) and follows the packing date until someone types their own. When the
 * sizes differ, it stays empty and each size's lot gets its own date.
 */
export function PackDates({ today, sizes }: { today: string; sizes: Size[] }) {
  const labels = new Set(sizes.map((s) => shelfLifeLabel(s.shelf)));
  const shared = sizes.length > 0 && labels.size === 1 && sizes[0]!.shelf ? sizes[0]!.shelf : null;
  const [packedOn, setPackedOn] = useState(today);
  const [own, setOwn] = useState<string | null>(null);
  const auto = shared ? (bestBeforeFrom(packedOn, shared) ?? "") : "";
  const value = own ?? auto;
  const missing = sizes.filter((s) => !s.shelf);

  return (
    <div className="row" style={{ marginBottom: 16, alignItems: "flex-start" }}>
      <div>
        <label htmlFor="packedOn">Packed on</label>
        <input id="packedOn" name="packedOn" type="date" required value={packedOn} onChange={(e) => setPackedOn(e.target.value)} />
      </div>
      <div style={{ minWidth: 220, flex: 1 }}>
        <label htmlFor="bestBefore">Best-before</label>
        <input id="bestBefore" name="bestBefore" type="date" value={value} onChange={(e) => setOwn(e.target.value)} style={{ maxWidth: 200 }} />
        <div className="small muted" style={{ marginTop: 4 }}>
          {shared && own === null && <>{shelfLifeLabel(shared)} from packing (shelf life in Settings). Change it here for this lot only.</>}
          {shared && own !== null && (
            <>
              Your date, for every size in this session.{" "}
              <button type="button" className="linkish" onClick={() => setOwn(null)}>
                Use the shelf life again
              </button>
            </>
          )}
          {!shared && sizes.some((s) => s.shelf) && (
            <>
              Leave it empty and each size gets its own:{" "}
              {sizes
                .filter((s) => s.shelf)
                .map((s) => `${s.name} ${shelfLifeLabel(s.shelf)} (${fmtDate(bestBeforeFrom(packedOn, s.shelf)!, { year: true })})`)
                .join(", ")}
              . A date typed here applies to every size.
            </>
          )}
          {missing.length > 0 && (
            <div>
              No shelf life yet for {missing.map((s) => s.name).join(", ")}. <a href="/settings/catalog">Set it in Settings</a>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
