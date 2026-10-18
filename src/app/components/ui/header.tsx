import Link from "next/link";
import { Icon } from "./icons";

/**
 * The top of every page: an optional way back, the title (with its status),
 * one line of context, and the page's main actions on the right.
 */
export function PageHeader({
  title,
  status,
  lead,
  back,
  actions,
}: {
  title: React.ReactNode;
  status?: { label: string; cls?: string } | null;
  lead?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="titles">
        {back && (
          <Link href={back.href} className="back">
            <Icon name="back" className="" size={14} />
            {back.label}
          </Link>
        )}
        <h1>
          {title}
          {status && <span className={`badge ${status.cls ?? ""}`}>{status.label}</span>}
        </h1>
        {lead && <div className="lead">{lead}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export interface StepLink {
  key: string;
  label: string;
  href: string;
  done?: boolean;
}

/** Numbered steps of one job (run, batch), shown as tabs: you can jump, but the order is the advice. */
export function Steps({ steps, current, label }: { steps: StepLink[]; current: string; label: string }) {
  return (
    <nav className="steps" aria-label={label}>
      {steps.map((s, i) => (
        <Link key={s.key} href={s.href} aria-current={s.key === current ? "page" : undefined} className={s.done ? "done" : undefined}>
          <span className="n">{i + 1}</span>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** A quiet "nothing here yet" that says what would appear and how to start. */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
