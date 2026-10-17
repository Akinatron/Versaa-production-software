import Link from "next/link";
import { db } from "@/db/client";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../../components/flash";
import { OUTFLOW } from "../../../components/labels";
import { saveOutflow } from "../../actions";
import { activeProducts, customerList, finishedLots, todayIso } from "../../data";

export const dynamic = "force-dynamic";

const TYPES = ["sale", "sample", "waste", "internal_use"] as const;
const EXPLAIN: Record<(typeof TYPES)[number], string> = {
  sale: "Jars sold and handed over without a sales order (e.g. at a market). This counts as sales.",
  sample: "Jars given away to try. Not a sale: no revenue is counted.",
  waste: "Jars thrown away (broken, spoiled, failed check). Not a sale. Say why in the note.",
  internal_use: "Jars used by the team (tasting, recipes, staff). Not a sale.",
};

export default async function NewOutflowPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const type = (TYPES as readonly string[]).includes(params.type ?? "") ? (params.type as (typeof TYPES)[number]) : "sale";
  const [products, customers, avail, lots] = await Promise.all([activeProducts(), customerList(), finishedAvailability(db()), finishedLots()]);
  const free = new Map(avail.map((a) => [a.productId, a.available]));
  const isSale = type === "sale";

  return (
    <>
      <h1>Jars out without an order</h1>
      <p className="lead">Record jars that leave stock directly. Stock goes down as soon as you save. Only “Sale” counts as sales.</p>
      <Flash params={params} />

      <div className="card">
        <label>What is it?</label>
        <div className="row" style={{ gap: 8 }}>
          {TYPES.map((x) => (
            <Link
              key={x}
              href={`/sales/outflow/new?type=${x}`}
              className={`badge ${x === type ? "ok" : ""}`}
              style={{ padding: "6px 14px", border: "1px solid var(--border)", textDecoration: "none", color: x === type ? undefined : "var(--text)" }}
              aria-current={x === type ? "page" : undefined}
            >
              {OUTFLOW[x]}
            </Link>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {EXPLAIN[type]}
        </p>
      </div>

      <form action={saveOutflow}>
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        <input type="hidden" name="type" value={type} />
        <div className="card grid">
          <div>
            <label htmlFor="customerId">Customer (optional)</label>
            <select id="customerId" name="customerId" defaultValue="">
              <option value="">—</option>
              {customers
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <div className="small">
              <Link href={`/sales/customers?back=${encodeURIComponent(`/sales/outflow/new?type=${type}`)}`}>Add a customer</Link>
            </div>
          </div>
          <div>
            <label htmlFor="destination">Destination (optional)</label>
            <input id="destination" name="destination" type="text" placeholder={type === "waste" ? "e.g. bin" : "e.g. Saturday market Utrecht"} />
          </div>
          <div>
            <label htmlFor="occurredOn">Date (required)</label>
            <input id="occurredOn" name="occurredOn" type="date" required defaultValue={todayIso()} />
          </div>
          <div>
            <label htmlFor="reference">Reference (optional)</label>
            <input id="reference" name="reference" type="text" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="note">Note {type === "waste" ? "(required: why are these jars thrown away?)" : "(optional)"}</label>
            <textarea id="note" name="note" rows={2} required={type === "waste"} />
          </div>
        </div>

        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Jars</th>
                <th>From lot (optional)</th>
                {isSale && <th>Price per jar (optional)</th>}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }, (_, i) => (
                <tr key={i}>
                  <td>
                    <select name={`product_${i}`} defaultValue="" aria-label="Product">
                      <option value="">—</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({free.get(p.id)?.toString() ?? "0"} free)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input name={`jars_${i}`} type="number" min="1" step="1" inputMode="numeric" aria-label="Jars" />
                  </td>
                  <td>
                    <select name={`lot_${i}`} defaultValue="" aria-label="Lot">
                      <option value="">Earliest best-before first</option>
                      {products
                        .filter((p) => lots.some((l) => l.productId === p.id))
                        .map((p) => (
                          <optgroup key={p.id} label={p.name}>
                            {lots
                              .filter((l) => l.productId === p.id)
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.code} · best before {l.bestBefore ?? "not recorded"} · {l.balance.toString()} left
                                </option>
                              ))}
                          </optgroup>
                        ))}
                    </select>
                  </td>
                  {isSale && (
                    <td>
                      <input name={`price_${i}`} type="number" min="0" step="0.01" inputMode="decimal" aria-label="Price per jar" placeholder="€" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Rows without a product are ignored. If you pick a lot, all jars of that row come from it; otherwise the earliest best-before comes first.
            {isSale && " Price: only if agreed — leave empty otherwise."} Jars promised to pending orders can&apos;t be used here.
          </p>
        </div>
        <button type="submit">Record {OUTFLOW[type]?.toLowerCase()}</button>
      </form>
      <p>
        <Link href="/sales">← Back to sales</Link>
      </p>
    </>
  );
}
