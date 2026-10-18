import Link from "next/link";
import { BATCH_STATUS } from "./labels";
import { PageHeader, Steps } from "./ui/header";
import { fmtDate } from "./ui/format";
import { SauceName } from "./sauce-name";

type Step = "summary" | "production" | "packaging";

/** Batch header with its three pages: Production (ingredients), Packaging, and the batch summary (close). */
export function BatchSteps({
  batch,
  sauceName,
  sauceColor,
  run,
  current,
  versionNo,
  actions,
}: {
  batch: { id: string; code: string; status: string };
  sauceName: string;
  sauceColor?: string | null;
  run: { id: string; code: string; plannedFor: string };
  current: Step;
  versionNo: number;
  actions?: React.ReactNode;
}) {
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, cls: "" };
  const steps = [
    {
      key: "production",
      label: "Ingredients",
      href: `/production/${batch.id}`,
    },
    { key: "packaging", label: "Jars", href: `/packaging/${batch.id}` },
    {
      key: "summary",
      label: "Summary and close",
      href: `/batches/${batch.id}`,
    },
  ];
  const back =
    current === "production"
      ? { href: "/production", label: "Production" }
      : current === "packaging"
        ? { href: "/packaging", label: "Packaging" }
        : { href: "/batches", label: "Batches" };
  return (
    <>
      <PageHeader
        back={back}
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
