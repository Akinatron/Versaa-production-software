import { ARTICLES, FAQ, GLOSSARY, areaLabel } from "./index";
import { toPlain } from "./inline";
import type { Block } from "./types";

function blockText(b: Block): string {
  if (typeof b === "string") return b;
  if ("h" in b) return b.h;
  if ("ul" in b) return b.ul.join(" ");
  if ("ol" in b) return b.ol.join(" ");
  if ("note" in b) return b.note;
  if ("flow" in b) return b.flow.join(" ");
  return [...b.table.head, ...b.table.rows.flat()].join(" ");
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Anchor of a question on the FAQ page. */
export const faqAnchor = (q: string) => `q-${slugOf(q).slice(0, 60)}`;
/** Anchor of a term on the glossary page. */
export const termAnchor = (term: string) => `t-${slugOf(term)}`;

/** Everything Help can find, for the search box. */
export function searchEntries() {
  return [
    ...ARTICLES.map((a) => ({
      href: `/help/${a.slug}`,
      title: a.title,
      kind: "Guide",
      sub: `${areaLabel(a.area)} · ${toPlain(a.summary)}`,
      text: toPlain(
        [
          a.title,
          a.summary,
          ...(a.keywords ?? []),
          ...(a.before ?? []),
          ...(a.steps ?? []),
          ...(a.changes ?? []),
          ...(a.more ?? []).map(blockText),
          ...(a.mistakes ?? []).flatMap((m) => [m.problem, m.fix]),
        ].join(" "),
      ).toLowerCase(),
    })),
    ...FAQ.map((f) => ({
      href: `/help/faq#${faqAnchor(f.q)}`,
      title: f.q,
      kind: "Question",
      sub: toPlain(blockText(f.a[0] ?? "")).slice(0, 110),
      text: toPlain([f.q, ...f.a.map(blockText)].join(" ")).toLowerCase(),
    })),
    ...GLOSSARY.map((g) => ({
      href: `/help/glossary#${termAnchor(g.term)}`,
      title: g.term,
      kind: "Term",
      sub: toPlain(g.def),
      text: toPlain(`${g.term} ${g.def}`).toLowerCase(),
    })),
  ];
}
