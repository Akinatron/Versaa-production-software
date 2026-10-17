import { db } from "@/db/client";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { UNITS } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { saveOpeningCount } from "../actions";

export const dynamic = "force-dynamic";

export default async function CountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, stock] = await Promise.all([loadPlanCatalog(db()), loadStockPositions(db())]);
  const items = catalog.items.filter((i) => stock[i.id]?.onHand == null).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "ingredient" ? -1 : 1));

  return (
    <>
      <h1>Opening stock count</h1>
      <p className="lead">
        Enter what you have right now. Leave a field empty if you haven't counted it yet; enter 0 if you counted and have
        none. You can come back for the rest.
      </p>
      <Flash params={params} />
      {items.length === 0 ? (
        <p className="card">Every item has been counted.</p>
      ) : (
        <form action={saveOpeningCount}>
          <input type="hidden" name="key" value={crypto.randomUUID()} />
          <div className="card">
            <label htmlFor="countedOn">Counted on</label>
            <input id="countedOn" name="countedOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} style={{ maxWidth: 200 }} />
          </div>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Best before (if known)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>
                      <div className="row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                        <input name={`q:${i.id}`} type="number" min="0" step={i.stockUnit === "unit" ? 1 : "any"} inputMode="decimal" aria-label={`${i.name} quantity`} />
                        <span className="muted small">{UNITS[i.stockUnit].label}</span>
                      </div>
                    </td>
                    <td>
                      {i.kind === "ingredient" && <input name={`bb:${i.id}`} type="date" aria-label={`${i.name} best before`} style={{ maxWidth: 170 }} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit">Save count</button>
          <p className="small muted">Saving adds these quantities to stock. Counts can't be edited afterwards; mistakes are fixed with a correction so the history stays visible.</p>
        </form>
      )}
    </>
  );
}
