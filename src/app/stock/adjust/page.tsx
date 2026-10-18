import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { LotOrigin, lotQty } from "../../components/trace-format";
import { saveStockCount, saveWriteOff } from "../actions";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";
import { GuardedForm } from "../../components/unsaved-guard";

export const dynamic = "force-dynamic";

const KINDS = [
  ["ingredient", "Ingredients"],
  ["packaging", "Packaging"],
  ["finished", "Finished jars"],
] as const;

type Item = typeof t.items.$inferSelect;

function AnyItemSelect({ items, value, kinds }: { items: Item[]; value?: string; kinds: readonly string[] }) {
  return (
    <select id="item" name="item" defaultValue={value ?? ""}>
      <option value="">Choose an item…</option>
      {KINDS.filter(([k]) => kinds.includes(k)).map(([k, label]) => (
        <optgroup key={k} label={label}>
          {items
            .filter((i) => i.kind === k)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

async function lotsOf(itemId: string | null) {
  const rows = await db()
    .select({
      lot: t.lots,
      item: t.items,
      supplier: t.suppliers.name,
      batchCode: t.productionBatches.code,
      balance: sql<string>`coalesce((select sum(m.quantity) from movements m where m.lot_id = ${t.lots.id}), 0)`,
    })
    .from(t.lots)
    .innerJoin(t.items, eq(t.lots.itemId, t.items.id))
    .leftJoin(t.suppliers, eq(t.lots.supplierId, t.suppliers.id))
    .leftJoin(t.productionBatches, eq(t.lots.batchId, t.productionBatches.id))
    .where(itemId ? eq(t.lots.itemId, itemId) : sql`true`)
    .orderBy(asc(t.items.name), t.lots.bestBefore, t.lots.receivedOn);
  return rows.filter((r) => new Decimal(r.balance).gt(0));
}

export default async function AdjustPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const mode = params.mode === "writeoff" ? "writeoff" : "count";
  const items = (await db().select().from(t.items).orderBy(asc(t.items.name))).filter((i) => i.active);
  const item = items.find((i) => i.id === params.item) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const tab = (m: string, label: string) => (
    <Link href={`/stock/adjust?mode=${m}${item ? `&item=${item.id}` : ""}`} aria-current={m === mode ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        back={item ? { href: `/stock/${item.id}`, label: item.name } : { href: "/stock", label: "Stock" }}
        title="Correct stock"
        lead="Numbers are never overwritten. A correction or write-off is its own line with your reason, so the history always explains the number."
      />
      <Flash params={params} />
      <nav className="tabs" aria-label="Kind of correction">
        {tab("count", "Count correction")}
        {tab("writeoff", "Write-off")}
      </nav>
      {mode === "count" ? <CountForm items={items} item={item} today={today} /> : <WriteOffForm items={items} item={item} today={today} />}
      <p className="small muted">
        For items that have never been counted, use the <Link href="/stock/count">opening count</Link> instead.
      </p>
    </>
  );
}

async function CountForm({ items, item, today }: { items: Item[]; item: Item | null; today: string }) {
  const lots = item ? await lotsOf(item.id) : [];
  const unit = (item?.stockUnit ?? "unit") as UnitCode;
  const unitWord = item?.kind === "finished" ? "jars" : UNITS[unit].label;
  return (
    <>
      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="mode" value="count" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="item">Item you counted</label>
          <AnyItemSelect items={items} value={item?.id} kinds={["ingredient", "packaging", "finished"]} />
        </div>
        <button type="submit" className="secondary">
          Show its lots
        </button>
      </form>
      {item && (
        <GuardedForm action={saveStockCount}>
          <input type="hidden" name="key" value={crypto.randomUUID()} />
          <input type="hidden" name="itemId" value={item.id} />
          <div className="card scroll">
            <h3 style={{ marginTop: 0 }}>{item.name}</h3>
            <p className="small muted">
              Enter what you actually counted for each lot, in {unitWord}. Leave a lot blank if you didn&apos;t count it (it stays as it is); enter 0 if
              it&apos;s gone. The difference with what the system expects is recorded as a correction.
            </p>
            {lots.length === 0 ? (
              <p className="muted">No lots of this item have stock. If you found some, enter it under “found stock without a lot”.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Where it came from</th>
                    <th>Best before</th>
                    <th className="num">System says</th>
                    <th>Counted</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(({ lot, supplier, batchCode, balance }) => (
                    <tr key={lot.id}>
                      <td>{lot.code}</td>
                      <td className="small">
                        <LotOrigin lot={{ ...lot, supplierName: supplier }} batchCode={batchCode} />
                      </td>
                      <td>{lot.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : <span className="muted">not recorded</span>}</td>
                      <td className="num">{lotQty(balance, unit, item.kind)}</td>
                      <td>
                        <input
                          name={`count:${lot.id}`}
                          type="number"
                          min="0"
                          step={unit === "unit" ? 1 : "any"}
                          inputMode="decimal"
                          aria-label={`Counted in ${lot.code}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4 style={{ marginBottom: 4 }}>Found stock without a lot (optional)</h4>
            <p className="small muted" style={{ marginTop: 0 }}>
              Stock you found that doesn&apos;t belong to any lot above. It is added as a new lot marked “found during a stock count”.
            </p>
            <div className="row">
              <div>
                <label htmlFor="found">Quantity ({unitWord})</label>
                <input id="found" name="found" type="number" min="0" step={unit === "unit" ? 1 : "any"} inputMode="decimal" />
              </div>
              <div>
                <label htmlFor="foundBestBefore">Best before (if known)</label>
                <input id="foundBestBefore" name="foundBestBefore" type="date" style={{ maxWidth: 180 }} />
              </div>
            </div>
          </div>
          <div className="card grid">
            <div>
              <label htmlFor="countedOn">Counted on (required)</label>
              <input id="countedOn" name="countedOn" type="date" required defaultValue={today} />
            </div>
            <div>
              <label htmlFor="reason">Reason (required)</label>
              <input id="reason" name="reason" type="text" required placeholder="e.g. monthly count, breakage found" />
            </div>
          </div>
          <div className="savebar">
            <button type="submit">Save count</button>
            <span className="small muted">Only the differences are recorded. The original numbers and this correction both stay in the history.</span>
          </div>
        </GuardedForm>
      )}
    </>
  );
}

async function WriteOffForm({ items, item, today }: { items: Item[]; item: Item | null; today: string }) {
  const lots = (await lotsOf(item && item.kind !== "finished" ? item.id : null)).filter((l) => l.item.kind !== "finished");
  return (
    <>
      <p className="small muted">
        Take stock out of a specific lot: thrown away, used by the team, or given as a sample. For finished jars, use{" "}
        <Link href="/outbound/new">Outbound: record a stock exit</Link> instead, so it shows up where the jars went.
      </p>
      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="mode" value="writeoff" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="item">Show lots of (optional)</label>
          <AnyItemSelect items={items} value={item?.kind !== "finished" ? item?.id : undefined} kinds={["ingredient", "packaging"]} />
        </div>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>
      <GuardedForm action={saveWriteOff}>
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        <input type="hidden" name="itemId" value={item?.id ?? ""} />
        <div className="card grid">
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="lotId">Lot (required)</label>
            {lots.length === 0 ? (
              <p className="muted">No lots with stock{item ? ` for ${item.name}` : ""}.</p>
            ) : (
              <select id="lotId" name="lotId" required defaultValue={lots.length === 1 ? lots[0]!.lot.id : ""}>
                <option value="">Choose a lot…</option>
                {[...new Set(lots.map((l) => l.item.id))].map((iid) => {
                  const its = lots.filter((l) => l.item.id === iid);
                  return (
                    <optgroup key={iid} label={its[0]!.item.name}>
                      {its.map(({ lot, item: it, balance }) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.code} · {lotQty(balance, it.stockUnit, it.kind)} left
                          {lot.bestBefore ? ` · best before ${fmtDate(lot.bestBefore, { year: true })}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="quantity">Quantity (required, in the lot&apos;s unit shown above)</label>
            <input id="quantity" name="quantity" type="number" min="0" step="any" inputMode="decimal" required />
          </div>
          <div>
            <label htmlFor="type">What happened (required)</label>
            <select id="type" name="type" required defaultValue="waste">
              <option value="waste">Waste (thrown away, broken, spoiled)</option>
              <option value="internal_use">Internal use (tasting, testing, staff)</option>
              <option value="sample">Sample (given away)</option>
            </select>
          </div>
          <div>
            <label htmlFor="occurredOn">Date (required)</label>
            <input id="occurredOn" name="occurredOn" type="date" required defaultValue={today} />
          </div>
          <div>
            <label htmlFor="reason">Reason (required)</label>
            <input id="reason" name="reason" type="text" required placeholder="e.g. bag torn, mould found" />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit">Write off</button>
          <span className="small muted">You can&apos;t write off more than the lot has left.</span>
        </div>
      </GuardedForm>
    </>
  );
}
