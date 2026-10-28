import Link from "next/link";
import { AREAS, FAQ, getArticle } from "@/help/index";
import { faqAnchor } from "@/help/search";
import { PageHeader } from "../../components/ui/header";
import { HelpBlock } from "../../components/help-text";

export const metadata = { title: "Common questions · Help" };

export default function FaqPage() {
  return (
    <div className="help-article">
      <PageHeader back={{ href: "/help", label: "Help" }} title="Common questions" lead="Short answers, each with a link to the full guide." />
      {AREAS.filter((a) => FAQ.some((f) => f.area === a.key)).map((area) => (
        <section key={area.key} aria-labelledby={`faq-${area.key}`}>
          <h2 id={`faq-${area.key}`}>{area.label}</h2>
          <div className="card help-faq">
            {FAQ.filter((f) => f.area === area.key).map((f) => (
              <details key={f.q} id={faqAnchor(f.q)}>
                <summary>{f.q}</summary>
                <div className="answer">
                  {f.a.map((b, i) => (
                    <HelpBlock key={i} block={b} />
                  ))}
                  {f.related?.length ? (
                    <p className="small">
                      Read more:{" "}
                      {f.related.map((s, i) => (
                        <span key={s}>
                          {i > 0 && " · "}
                          <Link href={`/help/${s}`}>{getArticle(s)?.title ?? s}</Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      <OpenFromHash />
    </div>
  );
}

/** Opens the question a link points at (…/faq#q-…), so it isn't left folded. */
function OpenFromHash() {
  const js = `(()=>{const o=()=>{const id=decodeURIComponent(location.hash.slice(1));const d=id&&document.getElementById(id);if(d&&d.tagName==="DETAILS"){d.open=true;d.scrollIntoView({block:"start"});}};o();addEventListener("hashchange",o);})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
