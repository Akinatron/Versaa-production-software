import Link from "next/link";
import { GLOSSARY, getArticle } from "@/help/index";
import { termAnchor } from "@/help/search";
import { PageHeader } from "../../components/ui/header";
import { HelpInline } from "../../components/help-text";

export const metadata = { title: "Glossary · Help" };

export default function GlossaryPage() {
  const terms = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <div className="help-article">
      <PageHeader back={{ href: "/help", label: "Help" }} title="Glossary" lead="The words Versaa uses, in plain language." />
      <dl className="card help-glossary">
        {terms.map((g) => {
          const see = g.see ? getArticle(g.see) : undefined;
          return (
            <div key={g.term} id={termAnchor(g.term)}>
              <dt>{g.term}</dt>
              <dd>
                <HelpInline text={g.def} />
                {see && (
                  <>
                    {" "}
                    <Link href={`/help/${see.slug}`} className="small">
                      {see.title}
                    </Link>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
