import Link from "next/link";
import { db } from "@/db/client";
import { setupSteps } from "@/db/help";
import { AREAS, FAQ, articlesIn } from "@/help/index";
import { searchEntries, faqAnchor } from "@/help/search";
import type { StageKey } from "@/help/types";
import { PageHeader } from "../components/ui/header";
import { FlowStrip, HelpInline } from "../components/help-text";
import { HelpSearch } from "./help-search";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help" };

/** The guide each stage of the main path opens. */
const STAGE_GUIDE: Record<StageKey, string> = {
  plan: "/help/plan-production",
  buy: "/help/order-whats-missing",
  receive: "/help/record-delivery",
  cook: "/help/cook-batch",
  pack: "/help/pack-batch",
  close: "/help/close-batch",
  sell: "/help/outbound",
};

const TOP_QUESTIONS = 5;

export default async function HelpPage() {
  const steps = await setupSteps(db());
  const needed = steps.filter((s) => !s.optional);
  const done = needed.filter((s) => s.done).length;
  const allDone = done === needed.length;

  const setupList = (
    <ul className="worklist setup-list">
      {steps.map((s) => (
        <li key={s.key} className={s.done ? "is-done" : undefined}>
          <span className={`check${s.done ? " on" : ""}`} aria-label={s.done ? "Done" : "Not done yet"} />
          <div className="what">
            <Link href={`/help/${s.slug}`}>{s.label}</Link>
            {s.optional && <span className="small muted"> · optional</span>}
            <div className="sub">{s.detail}</div>
          </div>
          {!s.done && (
            <Link href={s.href} className="btn sm secondary">
              Open
            </Link>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title="Help" lead="How Versaa works, step by step." />

      <HelpSearch entries={searchEntries()} />

      {allDone ? (
        <details className="card">
          <summary>
            <strong>Set-up complete</strong>{" "}
            <span className="small muted" style={{ fontWeight: 400 }}>
              every step of Start here is done
            </span>
          </summary>
          {setupList}
        </details>
      ) : (
        <section className="card" aria-labelledby="start-here">
          <div className="card-head">
            <h2 id="start-here">Start here</h2>
            <span className="small muted">
              {done} of {needed.length} done
            </span>
            <Link href="/help/set-up" className="more">
              Why this order
            </Link>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={needed.length} aria-valuenow={done} aria-label="Set-up done">
            <span style={{ width: `${(done / needed.length) * 100}%` }} />
          </div>
          {setupList}
        </section>
      )}

      <section aria-labelledby="path">
        <h2 id="path">The main path</h2>
        <FlowStrip links={STAGE_GUIDE} />
        <p className="small muted">
          Each step opens its guide. New to Versaa? Read <Link href="/help/what-is-versaa">Versaa in five minutes</Link>, then{" "}
          <Link href="/help/first-run">your first run, start to finish</Link>.
        </p>
      </section>

      <div className="help-areas">
        {AREAS.map((area) => (
          <section key={area.key} className="card" aria-labelledby={`area-${area.key}`}>
            <h2 id={`area-${area.key}`}>{area.label}</h2>
            <p className="small muted">{area.lead}</p>
            <ul className="help-links">
              {articlesIn(area.key).map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`}>{a.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="split">
        <section className="card" aria-labelledby="faq">
          <div className="card-head">
            <h2 id="faq">Common questions</h2>
            <Link href="/help/faq" className="more">
              All {FAQ.length}
            </Link>
          </div>
          <ul className="help-links">
            {FAQ.slice(0, TOP_QUESTIONS).map((f) => (
              <li key={f.q}>
                <Link href={`/help/faq#${faqAnchor(f.q)}`}>{f.q}</Link>
              </li>
            ))}
          </ul>
          <p className="small" style={{ marginTop: 12 }}>
            <Link href="/help/glossary">Glossary</Link>: what words like lot, reservation or sellable jars mean.
          </p>
        </section>

        <section className="card" aria-labelledby="ai-manual">
          <div className="card-head">
            <h2 id="ai-manual">Manual for an AI assistant</h2>
          </div>
          <p className="small">
            <HelpInline text="One Markdown file with every guide, question and term here. Give it to ChatGPT, Claude or any assistant and ask it anything about Versaa, in any language." />
          </p>
          <form action="/help/manual" method="get" className="stack">
            <label className="check-row">
              <input type="checkbox" name="setup" value="1" />
              <span>
                Include my recipes and settings
                <span className="small muted">
                  {" "}
                  Recipes, products, items, suppliers and prices from this app, so it can answer with your numbers. Leave it off if the file may be shared.
                </span>
              </span>
            </label>
            <div>
              <button type="submit">Download manual (.md)</button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
