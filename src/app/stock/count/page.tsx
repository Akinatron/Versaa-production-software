import { db } from "@/db/client";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { UNITS } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { saveOpeningCount } from "../actions";
import { PageHeader, Empty } from "../../components/ui/header";
import { GuardedForm } from "../../components/unsaved-guard";
import { today } from "@/domain/dates";
import { NumberInput } from "../../components/ui/number-input";

export const dynamic = "force-dynamic";

export default async function CountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, stock] = await Promise.all([loadPlanCatalog(db()), loadStockPositions(db())]);
  const items = catalog.items
    .filter((i) => stock[i.id]?.onHand == null)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "ingredient" ? -1 : 1));

  return (
    <>
      <PageHeader
        back={{ href: "/stock", label: "Stock" }}
        title="Opening stock count"
        lead="Leave a field empty if you haven't counted it; enter 0 if you have none."
      />
      <Flash params={params} />
      {items.length === 0 ? (
        <Empty title="Every item has been counted">
          <p>To fix a number, use a correction from the Stock page.</p>
        </Empty>
      ) : (
        <GuardedForm action={saveOpeningCount}>
          <input type="hidden" name="key" value={crypto.randomUUID()} />
          <div className="card">
            <label htmlFor="countedOn">Counted on</label>
            <input id="countedOn" name="countedOn" type="date" required defaultValue={today()} style={{ maxWidth: 200 }} />
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
                        <NumberInput
                          name={`q:${i.id}`}
                          aria-label={`${i.name} quantity`}
                        />
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
          <div className="savebar">
            <button type="submit">Save count</button>
            <span className="small muted">Counts can't be edited afterwards; mistakes are fixed with a correction so the history stays visible.</span>
          </div>
        </GuardedForm>
      )}
    </>
  );
}
