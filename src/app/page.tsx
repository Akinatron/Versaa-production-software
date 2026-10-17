import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanInput } from "@/db/planning";

export const dynamic = "force-dynamic";

const tiles = [
  { href: "/plan", title: "Plan production", text: "Jars per sauce and size → batches, ingredients, packaging and what to buy." },
  { href: "/deliveries/new", title: "Record a delivery", text: "What arrived, with supplier batch and best-before." },
  { href: "/orders", title: "Purchase orders", text: "What's ordered and still pending." },
  { href: "/stock", title: "Stock", text: "What you have, by lot, and what's reserved." },
];

export default async function Home() {
  const [input, runs, orders] = await Promise.all([
    loadPlanInput(db(), {}),
    db().select().from(t.productionRuns).where(inArray(t.productionRuns.status, ["draft", "confirmed"])),
    db().select().from(t.purchaseOrders).where(inArray(t.purchaseOrders.status, ["sent", "partly_received"])),
  ]);
  const noYield = input.sauces.filter((s) => s.yield.litresPerBatch === null);
  const uncounted = input.items.filter((i) => input.stock[i.id]?.onHand == null);

  return (
    <>
      <h1>Versaa operations</h1>
      <p className="lead">
        {runs.length} upcoming run(s) · {orders.length} open order(s)
      </p>
      <ul className="issues">
        {noYield.length > 0 && (
          <li className="bad">
            {noYield.map((s) => s.name).join(", ")}: no litres-per-batch figure yet, so batches can't be calculated. <Link href="/settings">Enter an estimate</Link>.
          </li>
        )}
        {uncounted.length > 0 && (
          <li className="warn">
            {uncounted.length} of {input.items.length} ingredients and packaging items have no stock count yet. <Link href="/stock/count">Count stock</Link>.
          </li>
        )}
        {noYield.length === 0 && uncounted.length === 0 && <li className="ok">Everything needed for planning is set up.</li>}
      </ul>
      <div className="grid">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="card" style={{ color: "inherit", textDecoration: "none" }}>
            <strong>{tile.title} →</strong>
            <p className="muted small">{tile.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
