import { AREAS, ARTICLES, FAQ, GLOSSARY, articlesIn, getArticle } from "./index";
import { STAGES, type Article, type Block } from "./types";
import { toManualText } from "./inline";

/*
 * The downloadable manual: the same articles, FAQ and glossary as the Help
 * screens, as one Markdown file a person can give to an AI assistant
 * (ChatGPT, Claude…) and ask questions about the app.
 */

const md = toManualText;

function cell(text: string): string {
  return md(text).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function blockToMarkdown(b: Block): string {
  if (typeof b === "string") return md(b);
  if ("h" in b) return `#### ${md(b.h)}`;
  if ("ul" in b) return b.ul.map((x) => `- ${md(x)}`).join("\n");
  if ("ol" in b) return b.ol.map((x, i) => `${i + 1}. ${md(x)}`).join("\n");
  if ("note" in b) return `> ${md(b.note)}`;
  if ("flow" in b) return b.flow.join(" → ");
  const { head, rows } = b.table;
  return [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

export function articleToMarkdown(a: Article): string {
  const out: string[] = [`### ${a.title}`, `*${md(a.summary)}*`];
  if (a.stage) out.push(`Main path: ${STAGES.map((s) => (s.key === a.stage ? `**${s.label}**` : s.label)).join(" → ")}`);
  if (a.before?.length) out.push("#### Before you start", a.before.map((x) => `- ${md(x)}`).join("\n"));
  if (a.steps?.length) out.push("#### Steps", a.steps.map((x, i) => `${i + 1}. ${md(x)}`).join("\n"));
  if (a.changes?.length) out.push("#### What this changes", a.changes.map((x) => `- ${md(x)}`).join("\n"));
  if (a.more?.length) {
    if (a.steps?.length || a.before?.length || a.changes?.length) out.push("#### Good to know");
    for (const b of a.more) out.push(blockToMarkdown(b));
  }
  if (a.mistakes?.length) out.push("#### Common mistakes", a.mistakes.map((m) => `- **${md(m.problem)}** ${md(m.fix)}`).join("\n"));
  const related = (a.related ?? []).map((s) => getArticle(s)?.title).filter(Boolean);
  if (related.length) out.push(`Related: ${related.map((t) => `"${t}"`).join(", ")}.`);
  return out.join("\n\n");
}

export function buildManual(opts: { generatedOn: string; setup?: string | null }): string {
  const parts: string[] = [];
  parts.push(
    "# Versaa operations app: user manual",
    `Generated from the app on ${opts.generatedOn}. It describes the app exactly as it is in this version${opts.setup ? ", followed by this business's current setup" : ""}.`,
    "## For the AI assistant reading this",
    [
      "You are helping someone who uses Versaa, the operations app of a sauce maker: it plans production from target jar counts, works out batches, ingredients, packaging and purchases, tracks deliveries, cooking, packing, stock and sales, and traces every lot from supplier to customer. The app is used by one person on one computer.",
      "",
      "- Answer only from this manual. If it doesn't cover the question, say so plainly instead of guessing.",
      "- The app's screens and buttons are in English. Quote their names exactly as written here in **bold**, even when you answer in another language.",
      "- Reply in the language the user writes in.",
      "- When the answer is a procedure, give numbered steps and say which screen to open first (the side menu has Today, Make: Runs and Batches, Buy: Orders, Deliveries and Suppliers, Keep: Stock, Trace and History, Sell: Outbound and Reports, then Help and Settings).",
      "- Never make up figures (quantities, prices, yields). If the user asks for a number from their data, tell them where in the app to read it" +
        (opts.setup ? ', or use the "Your current setup" section at the end.' : "."),
    ].join("\n"),
    "## Contents",
    [
      ...AREAS.map((a, i) => `${i + 1}. ${a.label}: ${a.lead}`),
      `${AREAS.length + 1}. Frequently asked questions`,
      `${AREAS.length + 2}. Glossary`,
      ...(opts.setup ? [`${AREAS.length + 3}. Your current setup`] : []),
    ].join("\n"),
  );

  AREAS.forEach((area, i) => {
    parts.push(`## ${i + 1}. ${area.label}`, area.lead);
    for (const a of articlesIn(area.key)) parts.push(articleToMarkdown(a));
  });

  parts.push(`## ${AREAS.length + 1}. Frequently asked questions`);
  for (const f of FAQ) parts.push(`### ${f.q}`, ...f.a.map(blockToMarkdown));

  parts.push(`## ${AREAS.length + 2}. Glossary`, GLOSSARY.map((g) => `- **${g.term}**: ${md(g.def)}`).join("\n"));

  if (opts.setup) parts.push(`## ${AREAS.length + 3}. Your current setup`, opts.setup);

  parts.push(`---\n${ARTICLES.length} articles, ${FAQ.length} questions, ${GLOSSARY.length} terms.`);
  return parts.join("\n\n") + "\n";
}
