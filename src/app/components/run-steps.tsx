import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { RUN_STATUS } from "./labels";

export type RunStep = "run" | "stock" | "order" | "receive";

const STEPS: { key: RunStep; label: string; path: string }[] = [
  { key: "run", label: "1. Run", path: "" },
  { key: "stock", label: "2. Stock vs need", path: "/stock" },
  { key: "order", label: "3. Order", path: "/order" },
  { key: "receive", label: "4. Receive", path: "/receive" },
];

export async function loadRun(id: string) {
  const [run] = await db().select().from(t.productionRuns).where(eq(t.productionRuns.id, id));
  if (!run) notFound();
  return run;
}

/** Run title and the step tabs: what to make → stock vs need → order what's missing → receive it. */
export function RunHeader({ run, step }: { run: typeof t.productionRuns.$inferSelect; step: RunStep }) {
  const status = RUN_STATUS[run.status]!;
  return (
    <>
      <p className="small" style={{ margin: "0 0 8px" }}>
        <Link href="/runs">← Runs</Link>
      </p>
      <h1>
        {run.code} <span className={`badge ${status.cls}`}>{status.label}</span>
      </h1>
      <p className="lead">Production date {run.plannedFor}.</p>
      <nav className="row" style={{ gap: 8, marginBottom: 16 }} aria-label="Run steps">
        {STEPS.map((s) => {
          const active = s.key === step;
          return (
            <Link
              key={s.key}
              href={`/runs/${run.id}${s.path}`}
              aria-current={active ? "page" : undefined}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                textDecoration: "none",
                border: "1px solid var(--border)",
                background: active ? "var(--accent)" : "var(--surface)",
                color: active ? "#fff" : "var(--text)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function NextStep({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p style={{ marginTop: 24 }}>
      <Link href={href}>{children} →</Link>
    </p>
  );
}
