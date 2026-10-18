import Link from "next/link";
import { BATCH_STATUS } from "./labels";

type Step = "summary" | "production" | "packaging";

/** Batch header with its three pages: Production (ingredients), Packaging, and the batch summary (close). */
export function BatchSteps({
  batch,
  sauceName,
  run,
  current,
  versionNo,
}: {
  batch: { id: string; code: string; status: string };
  sauceName: string;
  run: { id: string; code: string; plannedFor: string };
  current: Step;
  versionNo: number;
}) {
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, cls: "" };
  const steps: [Step, string, string][] = [
    ["production", "1. Production: ingredients", `/production/${batch.id}`],
    ["packaging", "2. Packaging: jars", `/packaging/${batch.id}`],
    ["summary", "3. Batch summary and close", `/batches/${batch.id}`],
  ];
  return (
    <>
      <h1>
        {batch.code} <span className={`badge ${status.cls}`}>{status.label}</span>
      </h1>
      <p className="lead" style={{ marginBottom: 12 }}>
        {sauceName} · recipe version {versionNo} · run <Link href={`/runs/${run.id}`}>{run.code}</Link> (planned for {run.plannedFor})
      </p>
      <nav aria-label="Batch steps" className="row" style={{ gap: 8, marginBottom: 16 }}>
        {steps.map(([key, label, href]) =>
          key === current ? (
            <span key={key} className="badge" style={{ background: "var(--accent)", color: "#fff", padding: "8px 14px", fontSize: "0.95rem" }} aria-current="page">
              {label}
            </span>
          ) : (
            <Link key={key} href={href} className="badge" style={{ border: "1px solid var(--border)", padding: "8px 14px", fontSize: "0.95rem", color: "var(--text)", textDecoration: "none" }}>
              {label}
            </Link>
          ),
        )}
      </nav>
    </>
  );
}
