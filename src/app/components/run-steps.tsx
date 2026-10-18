import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { RUN_STATUS } from "./labels";
import { PageHeader, Steps } from "./ui/header";
import { dayOf, fmtDate } from "./ui/format";

export type RunStep = "run" | "stock" | "order" | "receive";

const STEPS: { key: RunStep; label: string; path: string }[] = [
  { key: "run", label: "What to make", path: "" },
  { key: "stock", label: "Stock vs need", path: "/stock" },
  { key: "order", label: "Order", path: "/order" },
  { key: "receive", label: "Receive", path: "/receive" },
];

export async function loadRun(id: string) {
  const [run] = await db().select().from(t.productionRuns).where(eq(t.productionRuns.id, id));
  if (!run) notFound();
  return run;
}

/** Run title and the step tabs: what to make → stock vs need → order what's missing → receive it. */
export function RunHeader({ run, step, actions }: { run: typeof t.productionRuns.$inferSelect; step: RunStep; actions?: React.ReactNode }) {
  const status = RUN_STATUS[run.status]!;
  return (
    <>
      <PageHeader
        back={{ href: "/runs", label: "Runs" }}
        title={run.code}
        status={status}
        lead={
          <>
            Production on {fmtDate(run.plannedFor, { weekday: true })} · created {fmtDate(dayOf(run.createdAt), { weekday: true })}
          </>
        }
        actions={actions}
      />
      <Steps
        label="Run steps"
        current={step}
        steps={STEPS.map((s) => ({
          key: s.key,
          label: s.label,
          href: `/runs/${run.id}${s.path}`,
        }))}
      />
    </>
  );
}

export function NextStep({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="form-actions" style={{ justifyContent: "flex-end", marginTop: 28 }}>
      <Link href={href} className="btn secondary">
        {children}
      </Link>
    </div>
  );
}
