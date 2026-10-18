import { db } from "@/db/client";
import { planForRun } from "@/db/operations";
import { Flash } from "../../../components/flash";
import { PlanView } from "../../../components/plan-view";
import { NextStep, RunHeader, loadRun } from "../../../components/run-steps";

export const dynamic = "force-dynamic";

/** Step 2: stock against what the run needs. */
export default async function RunStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const run = await loadRun(id);
  const live = await planForRun(db(), id);
  const short = live.requirements.filter((r) => r.status === "short").length;
  const unknown = live.requirements.filter((r) => r.status === "unknown").length;

  return (
    <>
      <RunHeader run={run} step="stock" />
      <Flash params={flash} />
      <ul className="issues">
        <li className={short ? "bad" : unknown ? "warn" : "ok"}>
          {short === 0 && unknown === 0
            ? "Everything this run needs is in stock or already on order."
            : `${short} item${short === 1 ? "" : "s"} to buy${unknown ? `, ${unknown} with unknown stock` : ""}. "On order" counts only orders already sent.`}
        </li>
      </ul>
      <PlanView result={live} only={["requirements"]} />
      {short > 0 && <NextStep href={`/runs/${id}/order`}>Order what's missing</NextStep>}
    </>
  );
}
