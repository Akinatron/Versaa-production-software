import Decimal from "decimal.js";
import { describePrice, money, unitPrice, type Offer } from "@/domain/pricing";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { setOfferAction, unlinkAction } from "../suppliers/actions";
import { fmtDate } from "./ui/format";

/** Edit one supplier ↔ item link: pack size, pack name and price. Used on both cards. */
export function OfferForm({ offer, unit, back, supplierCode }: { offer: Offer; unit: UnitCode; back: string; supplierCode?: string | null }) {
  const u = UNITS[unit].label;
  return (
    <details className="inline-edit">
      <summary className="small">Change price or pack</summary>
      <form action={setOfferAction} className="row" style={{ gap: 8, alignItems: "end", marginTop: 8 }}>
        <input type="hidden" name="supplierItemId" value={offer.supplierItemId} />
        <input type="hidden" name="back" value={back} />
        <div>
          <label className="small">Pack size ({u})</label>
          <input
            name="packQty"
            type="number"
            min="0"
            step="any"
            defaultValue={offer.packQty?.toString() ?? ""}
            placeholder="e.g. 25"
            style={{ maxWidth: 100 }}
          />
        </div>
        <div>
          <label className="small">Pack name</label>
          <input name="packName" type="text" defaultValue={offer.packName ?? ""} placeholder="sack, box…" style={{ maxWidth: 110 }} />
        </div>
        <div>
          <label className="small">Price € (per pack, or per {u === "units" ? "unit" : u})</label>
          <input name="price" type="number" min="0" step="any" defaultValue={offer.price?.toString() ?? ""} style={{ maxWidth: 100 }} />
        </div>
        <div>
          <label className="small">Supplier ref</label>
          <input name="supplierCode" type="text" defaultValue={supplierCode ?? ""} style={{ maxWidth: 110 }} />
        </div>
        <button type="submit" className="sm">
          Save
        </button>
        <button type="submit" formAction={unlinkAction} className="ghost sm">
          Remove link
        </button>
      </form>
    </details>
  );
}

/** Current price in words, with the price per stock unit when bought in packs. */
export function PriceText({ offer, unit }: { offer: Pick<Offer, "packQty" | "packName" | "price" | "since">; unit: UnitCode }) {
  const u = UNITS[unit].label;
  const per = unitPrice(offer);
  return (
    <>
      <strong>{describePrice(offer, u)}</strong>
      {offer.packQty && per && (
        <span className="small muted">
          {" "}
          ({money(per)} per {u === "units" ? "unit" : u})
        </span>
      )}
      {offer.since && <span className="small muted"> · since {fmtDate(offer.since.toISOString().slice(0, 10), { year: true })}</span>}
    </>
  );
}

export interface PriceRow {
  id: string;
  supplierItemId: string;
  packQty: string | null;
  packName: string | null;
  price: string | null;
  createdAt: Date;
}

/** Every price a link has had, newest first. */
export function PriceHistory({ rows, unit, label }: { rows: PriceRow[]; unit: UnitCode; label?: (r: PriceRow) => string }) {
  if (rows.length <= 1) return null;
  const u = UNITS[unit].label;
  return (
    <details>
      <summary className="small">Price history ({rows.length})</summary>
      <table className="small">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={i === 0 ? undefined : { color: "var(--muted)" }}>
              <td>
                {fmtDate(r.createdAt.toISOString().slice(0, 10), {
                  year: true,
                })}
              </td>
              {label && <td>{label(r)}</td>}
              <td>
                {describePrice(
                  {
                    packQty: r.packQty ? new Decimal(r.packQty) : null,
                    packName: r.packName,
                    price: r.price ? new Decimal(r.price) : null,
                  },
                  u,
                )}
                {i === 0 ? " (current)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
