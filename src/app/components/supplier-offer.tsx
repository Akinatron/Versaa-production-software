import Decimal from "decimal.js";
import { describePrice, money, unitPrice, type Offer } from "@/domain/pricing";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { linkAction, moveRankAction, setOfferAction, unlinkAction } from "../suppliers/actions";
import { fmtDate } from "./ui/format";
import { ReasonField } from "./history";
import { ConfirmButton } from "./unsaved-guard";

/** Edit one supplier ↔ item link: pack size, pack name and price. Used on both cards. */
export function OfferForm({
  offer,
  unit,
  back,
  supplierCode,
  open,
  itemName,
}: {
  offer: Offer;
  itemName: string;
  unit: UnitCode;
  back: string;
  supplierCode?: string | null;
  /** Start opened (when arriving from an "Edit" link elsewhere). */
  open?: boolean;
}) {
  const u = UNITS[unit].label;
  return (
    <details className="inline-edit price-edit" open={open}>
      <summary>{offer.price === null ? "Set price" : "Edit price"}</summary>
      <form action={setOfferAction} className="row" style={{ gap: 8, alignItems: "end", marginTop: 8 }}>
        <input type="hidden" name="supplierItemId" value={offer.supplierItemId} />
        <input type="hidden" name="back" value={back} />
        <div>
          <label className="small">Quantity for that price ({u})</label>
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
          <label className="small">Pack name (optional)</label>
          <input name="packName" type="text" defaultValue={offer.packName ?? ""} placeholder="sack, box…" style={{ maxWidth: 110 }} />
        </div>
        <div>
          <label className="small">Price (€)</label>
          <input name="price" type="number" min="0" step="any" defaultValue={offer.price?.toString() ?? ""} style={{ maxWidth: 100 }} autoFocus={open} />
        </div>
        <div>
          <label className="small">Supplier ref</label>
          <input name="supplierCode" type="text" defaultValue={supplierCode ?? ""} style={{ maxWidth: 110 }} />
        </div>
        <button type="submit" className="sm">
          Save
        </button>
      </form>
      {/* Kept apart from Save, with a reason and a question: removing a favourite changes who plans and orders use. */}
      <form action={unlinkAction} className="row unlink" style={{ gap: 8, alignItems: "end" }}>
        <input type="hidden" name="supplierItemId" value={offer.supplierItemId} />
        <input type="hidden" name="back" value={back} />
        <ReasonField
          id={`unlink-${offer.supplierItemId}`}
          label={`Stop buying ${itemName} from ${offer.supplierName}?`}
          placeholder="Why? Goes in the history"
        />
        <ConfirmButton
          className="danger sm"
          message={`Stop buying ${itemName} from ${offer.supplierName}?${offer.rank === 1 ? " It is the favourite: plans and orders will use the next supplier." : ""}`}
        >
          Remove link
        </ConfirmButton>
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

/**
 * Add a supplier ↔ item link. The same form on the supplier card (choose the
 * item) and on the item card (choose the supplier): both write the one link.
 */
export function AddLinkForm({
  supplierId,
  itemId,
  chooser,
  unitLabel,
  back,
  button,
  canBeFavourite,
}: {
  supplierId?: string;
  itemId?: string;
  /** The select for the side that isn't fixed. */
  chooser: React.ReactNode;
  /** The item's unit when known (item card); otherwise "the item's unit". */
  unitLabel?: string;
  back: string;
  button: string;
  /** Show "Make it the favourite" (only when the item already has another supplier, or the item isn't known yet). */
  canBeFavourite: boolean;
}) {
  const u = unitLabel ?? "item's unit";
  return (
    <form action={linkAction} className="card row" style={{ gap: 8, alignItems: "flex-end" }}>
      {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <input type="hidden" name="back" value={back} />
      {chooser}
      <div>
        <label>Price (€)</label>
        <input name="price" type="number" min="0" step="any" placeholder="e.g. 12" style={{ maxWidth: 110 }} />
      </div>
      <div>
        <label>Quantity for that price ({u})</label>
        <input name="packQty" type="number" min="0" step="any" placeholder="e.g. 25" style={{ maxWidth: 110 }} />
      </div>
      <div>
        <label>Pack name (optional)</label>
        <input name="packName" type="text" placeholder="sack, box…" style={{ maxWidth: 120 }} />
      </div>
      {canBeFavourite && (
        <label className="row small" style={{ gap: 6, alignItems: "center", margin: "0 0 10px" }}>
          <input type="checkbox" name="favourite" value="1" /> Make it the favourite
        </label>
      )}
      <button type="submit" className="secondary">
        {button}
      </button>
      <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
        For example 12 € for 25 kg. Leave the quantity empty if they sell any amount; the price is then per {u === "units" ? "unit" : u}. The link shows on both
        the supplier and the item, and changing it on one changes it on the other.
      </p>
    </form>
  );
}

/** "Make favourite" for one supplier ↔ item link; the same action on both cards. */
export function MakeFavourite({ supplierItemId, back }: { supplierItemId: string; back: string }) {
  return (
    <form action={moveRankAction}>
      <input type="hidden" name="supplierItemId" value={supplierItemId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" name="to" value="first" className="secondary sm">
        Make favourite
      </button>
    </form>
  );
}
