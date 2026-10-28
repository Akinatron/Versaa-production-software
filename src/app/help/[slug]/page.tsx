import Link from "next/link";
import { notFound } from "next/navigation";
import { FAQ, areaLabel, articlesIn, getArticle } from "@/help/index";
import { faqAnchor } from "@/help/search";
import { PageHeader } from "../../components/ui/header";
import { FlowStrip, HelpBlock, HelpInline, HelpSteps } from "../../components/help-text";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = getArticle((await params).slug);
  return { title: a ? `${a.title} · Help` : "Help" };
}

/** One help guide: what it's for, before you start, steps, what changes, good to know, mistakes, related. */
export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const a = getArticle((await params).slug);
  if (!a) notFound();

  const siblings = articlesIn(a.area);
  const i = siblings.findIndex((x) => x.slug === a.slug);
  const next = siblings[i + 1];
  const questions = FAQ.filter((f) => f.related?.includes(a.slug));
  const related = (a.related ?? []).map((s) => getArticle(s)).filter((x) => !!x);
  // Free text after the steps gets its own heading, unless it starts with one.
  const first = a.more?.[0];
  const goodToKnowHeading = !!(a.steps?.length || a.changes?.length || a.before?.length) && !(typeof first === "object" && "h" in first);

  return (
    <div className="help-article">
      <PageHeader
        back={{ href: "/help", label: `Help · ${areaLabel(a.area)}` }}
        title={a.title}
        lead={<HelpInline text={a.summary} />}
        actions={
          a.go ? (
            <Link href={a.go.href} className="btn">
              {a.go.label}
            </Link>
          ) : undefined
        }
      />

      {a.stage && <FlowStrip current={a.stage} />}

      {a.before?.length ? (
        <section className="card help-before" aria-labelledby="before">
          <h2 id="before">Before you start</h2>
          <ul className="help-list">
            {a.before.map((x, n) => (
              <li key={n}>
                <HelpInline text={x} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {a.steps?.length ? (
        <section aria-labelledby="steps">
          <h2 id="steps">Steps</h2>
          <HelpSteps steps={a.steps} />
        </section>
      ) : null}

      {a.changes?.length ? (
        <section aria-labelledby="changes">
          <h2 id="changes">What this changes</h2>
          <ul className="issues">
            {a.changes.map((x, n) => (
              <li key={n} className="info">
                <HelpInline text={x} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {a.more?.length ? (
        <section className="help-body" aria-label="Good to know">
          {goodToKnowHeading && <h2>Good to know</h2>}
          {a.more.map((b, n) => (
            <HelpBlock key={n} block={b} />
          ))}
        </section>
      ) : null}

      {a.mistakes?.length ? (
        <section aria-labelledby="mistakes">
          <h2 id="mistakes">Common mistakes</h2>
          <div className="card help-mistakes">
            {a.mistakes.map((m, n) => (
              <div key={n} className="mistake">
                <div className="problem">
                  <HelpInline text={m.problem} />
                </div>
                <div className="fix">
                  <HelpInline text={m.fix} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {questions.length > 0 && (
        <section aria-labelledby="questions">
          <h2 id="questions">Questions about this</h2>
          <ul className="help-links">
            {questions.map((f) => (
              <li key={f.q}>
                <Link href={`/help/faq#${faqAnchor(f.q)}`}>{f.q}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related">
          <h2 id="related">Related</h2>
          <nav className="card linklist" aria-labelledby="related">
            {related.map((r) => (
              <Link key={r.slug} href={`/help/${r.slug}`}>
                <span className="what">
                  <span>{r.title}</span>
                  <span className="sub">{areaLabel(r.area)}</span>
                </span>
              </Link>
            ))}
          </nav>
        </section>
      )}

      <div className="form-actions help-next">
        <Link href="/help" className="btn ghost">
          All help
        </Link>
        {next && (
          <Link href={`/help/${next.slug}`} className="btn secondary">
            Next in {areaLabel(a.area)}: {next.title}
          </Link>
        )}
      </div>
    </div>
  );
}
