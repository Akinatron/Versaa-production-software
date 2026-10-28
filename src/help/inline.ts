/*
 * The small inline Markdown the help text uses: **bold**, `code`,
 * [label](/screen) and [label](help:slug).
 */

export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };

const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else out.push({ t: "link", v: m[3]!, href: m[4]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Where a link goes inside the app: help:slug becomes the article's page. */
export function linkHref(href: string): string {
  return href.startsWith("help:") ? `/help/${href.slice(5)}` : href;
}

/** Text for the AI manual: links lose their address (an assistant can't open the app), the rest stays Markdown. */
export function toManualText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}

/** Plain text for search. */
export function toPlain(text: string): string {
  return parseInline(text)
    .map((p) => p.v)
    .join("");
}
