import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { sauceColorMaps } from "@/db/catalog";
import type { PlanResult } from "@/domain/planner";
import { BATCH_STATUS } from "./labels";
import { createBatches } from "../runs/actions";
import { SauceName } from "./sauce-name";

/** Run page: the run's batches, and once production has started, plan vs actual. */
export async function BatchRunSection({ runId, runStatus, frozen }: { runId: string; runStatus: string; frozen: PlanResult | null }) {
  if (runStatus === "draft" || runStatus === "cancelled") return null;
  const batches = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      sauceColor: t.sauces.color,
      versionNo: t.recipeVersions.versionNo,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.recipeVersions, eq(t.productionBatches.recipeVersionId, t.recipeVersions.id))
    .where(eq(t.productionBatches.runId, runId))
    .orderBy(t.productionBatches.code);

  const packed = await db().execute<{
    product_id: string;
    name: string;
    filled: number;
    rejected: number;
    accepted: number;
  }>(sql`
    select l.product_id, p.name, sum(l.filled)::int as filled, sum(l.rejected)::int as rejected, sum(l.accepted)::int as accepted
    from packaging_session_lines l
    join packaging_sessions s on s.id = l.session_id and s.deleted_at is null
    join production_batches b on b.id = s.batch_id
    join products p on p.id = l.product_id
    where b.run_id = ${runId}
    group by l.product_id, p.name`);
  const packedBy = new Map([...packed].map((r) => [r.product_id, r]));

  const showActual = runStatus === "in_progress" || runStatus === "closed";
  const productRows = [
    ...(frozen?.products ?? []).map((p) => ({
      productId: p.productId,
      name: p.name,
      target: p.targetJars as number | null,
    })),
    ...[...packedBy.values()]
      .filter((r) => !frozen?.products.some((p) => p.productId === r.product_id))
      .map((r) => ({ productId: r.product_id, name: r.name, target: null })),
  ];
  const colors = await sauceColorMaps(db());
  const sauceIds = [...new Set([...(frozen?.sauces ?? []).map((s) => s.sauceId), ...batches.map((b) => b.batch.sauceId)])];

  return (
    <>
      <h2>Batches</h2>
      <div className="card scroll">
        {batches.length === 0 ? (
          <div className="row">
            <p style={{ margin: 0, flexBasis: "100%" }}>
              This run has no batches yet (it was confirmed before batches existed). Create them from the forecast saved at confirmation: one batch per planned
              batch, following the recipe version in that forecast.
            </p>
            <form action={createBatches}>
              <input type="hidden" name="runId" value={runId} />
              <button type="submit">Create batches</button>
            </form>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Sauce</th>
                <th>Recipe</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(({ batch, sauce, sauceColor, versionNo }) => {
                const s = BATCH_STATUS[batch.status] ?? {
                  label: batch.status,
                  cls: "",
                };
                return (
                  <tr key={batch.id}>
                    <td>
                      <Link href={`/batches/${batch.id}`}>
                        <strong>{batch.code}</strong>
                      </Link>
                    </td>
                    <td>
                      <SauceName name={sauce} color={sauceColor} />
                    </td>
                    <td>v{versionNo}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showActual && (
        <>
          <h2>Plan vs actual</h2>
          <p className="small muted">
            Planned figures come from the forecast saved at confirmation. Actual figures are what has been recorded on the batches so far.
          </p>
          <div className="card scroll">
            <strong>Batches per sauce</strong>
            <table>
              <thead>
                <tr>
                  <th>Sauce</th>
                  <th className="num">Planned</th>
                  <th className="num">Closed</th>
                  <th className="num">Still open</th>
                  <th className="num">Not made</th>
                </tr>
              </thead>
              <tbody>
                {sauceIds.map((sid) => {
                  const line = frozen?.sauces.find((s) => s.sauceId === sid);
                  const mine = batches.filter((b) => b.batch.sauceId === sid);
                  const n = (f: (st: string) => boolean) => mine.filter((b) => f(b.batch.status)).length;
                  return (
                    <tr key={sid}>
                      <td>
                        <SauceName name={line?.name ?? mine[0]?.sauce ?? ""} color={colors.bySauce.get(sid)} />
                      </td>
                      <td className="num">{line?.batches ?? "unknown"}</td>
                      <td className="num">{n((s) => s === "closed")}</td>
                      <td className="num">{n((s) => s !== "closed" && s !== "cancelled")}</td>
                      <td className="num">{n((s) => s === "cancelled")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card scroll">
            <strong>Jars per product</strong>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Target (sellable)</th>
                  <th className="num">Accepted</th>
                  <th className="num">Difference</th>
                  <th className="num">Filled</th>
                  <th className="num">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((p) => {
                  const a = packedBy.get(p.productId);
                  const accepted = a?.accepted ?? 0;
                  const diff = p.target === null ? null : accepted - p.target;
                  return (
                    <tr key={p.productId}>
                      <td>
                        <SauceName name={p.name} color={colors.byProduct.get(p.productId)} />
                      </td>
                      <td className="num">{p.target ?? "—"}</td>
                      <td className="num">
                        <strong>{accepted}</strong>
                      </td>
                      <td className={`num ${diff === null ? "" : diff < 0 ? "text-bad" : ""}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff}`}</td>
                      <td className="num">{a?.filled ?? 0}</td>
                      <td className="num">{a?.rejected ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Accepted = filled − rejected; only accepted jars are in stock.
            </p>
          </div>
        </>
      )}
    </>
  );
}
