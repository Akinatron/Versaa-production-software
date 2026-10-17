import Link from "next/link";
import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";

export const dynamic = "force-dynamic";

export default async function Home() {
  const input = await loadPlanInput(db(), {});
  const noYield = input.sauces.filter((s) => s.yield.litresPerBatch === null);
  const uncounted = input.items.filter((i) => input.stock[i.id]?.onHand == null);

  return (
    <>
      <h1>Versaa operations</h1>
      <p className="lead">What needs attention before you can plan with confidence.</p>
      <ul className="issues">
        {noYield.length > 0 && (
          <li className="bad">
            {noYield.map((s) => s.name).join(", ")}: no litres-per-batch figure yet. <Link href="/settings">Enter an estimate</Link>.
          </li>
        )}
        {uncounted.length > 0 && (
          <li className="warn">
            {uncounted.length} of {input.items.length} ingredients and packaging items have no stock count yet. Recording an
            opening count comes in the next update.
          </li>
        )}
        {noYield.length === 0 && uncounted.length === 0 && <li className="ok">Everything needed for planning is set up.</li>}
      </ul>
      <div className="grid">
        <Link href="/plan" className="card" style={{ color: "inherit", textDecoration: "none" }}>
          <strong>Plan production →</strong>
          <p className="muted small">Enter jars per sauce and size, see batches, ingredients, packaging and what to buy.</p>
        </Link>
        <Link href="/settings" className="card" style={{ color: "inherit", textDecoration: "none" }}>
          <strong>Settings →</strong>
          <p className="muted small">Recipes, packaging per jar, yield and reject estimates.</p>
        </Link>
      </div>
    </>
  );
}
