import Link from "next/link";
import { BATCH_STATUS } from "./labels";
import { PageHeader, Steps } from "./ui/header";
import { fmtDate } from "./ui/format";
import { SauceName } from "./sauce-name";
import { batchHref, type BatchStep } from "./batch-paths";

/** Batch header with its three steps, all under /batches/[id]: Cook (ingredients), Pack (jars), Close (summary). */
export function BatchSteps({
  batch,
  sauceName,
  sauceColor,
  run,
  current,
  versionNo,
  progress,
  actions,
}: {
  batch: { id: string; code: string; status: string };
  sauceName: string;
  sauceColor?: string | null;
  run: { id: string; code: string; plannedFor: string };
  current: BatchStep;
  versionNo: number;
  /** Ticks on the steps already done: every ingredient recorded, at least one packaging session. */
  progress?: { cooked: boolean; packed: boolean };
  actions?: React.ReactNode;
}) {
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, cls: "" };
  const steps = [
    { key: "cook", label: "Cook", href: batchHref(batch.id, "cook"), done: progress?.cooked },
    { key: "pack", label: "Pack", href: batchHref(batch.id, "pack"), done: progress?.packed },
    { key: "close", label: "Close", href: batchHref(batch.id, "close"), done: batch.status === "closed" },
  ];
  const show = batch.status === "closed" || batch.status === "cancelled" ? "closed" : current === "cook" ? "cook" : "pack";
  return (
    <>
      <PageHeader
        back={{ href: `/batches?show=${show}`, label: "Batches" }}
        title={batch.code}
        status={status}
        lead={
          <>
            <SauceName name={sauceName} color={sauceColor} chip /> · recipe v{versionNo} · run <Link href={`/runs/${run.id}`}>{run.code}</Link> ·{" "}
            {fmtDate(run.plannedFor, { weekday: true })}
          </>
        }
        actions={actions}
      />
      <Steps label="Batch steps" current={current} steps={steps} />
    </>
  );
}
