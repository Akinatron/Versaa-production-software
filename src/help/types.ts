/*
 * The help content: written once, shown in the Help screens and turned into
 * the downloadable AI manual. Text uses a small part of Markdown:
 * **bold**, `code`, [label](/path) for a screen and [label](help:slug) for
 * another help article.
 */

export type AreaKey = "start" | "make" | "buy" | "keep" | "sell" | "settings" | "basics";

/** A piece of an article body. A plain string is a paragraph. */
export type Block =
  | string
  | { h: string }
  | { ul: string[] }
  | { ol: string[] }
  | { note: string }
  | { table: { head: string[]; rows: string[][] } }
  | { flow: string[] };

/** The main path of the work, shown as a strip on top of the articles that are one stage of it. */
export const STAGES = [
  { key: "plan", label: "Plan" },
  { key: "buy", label: "Buy" },
  { key: "receive", label: "Receive" },
  { key: "cook", label: "Cook" },
  { key: "pack", label: "Pack" },
  { key: "close", label: "Close" },
  { key: "sell", label: "Sell" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];

export interface Article {
  slug: string;
  area: AreaKey;
  title: string;
  /** One sentence: what this is for. Shown under the title and in lists. */
  summary: string;
  /** Where this sits on the main path, if it is one stage of it. */
  stage?: StageKey;
  /** The screen this article is about, for the "Go to this screen" button. */
  go?: { href: string; label: string };
  /** What has to exist before you start. */
  before?: string[];
  /** Numbered steps. */
  steps?: string[];
  /** What saving does to stock, reservations and records. */
  changes?: string[];
  /** Anything else worth knowing, in free blocks. */
  more?: Block[];
  /** Common mistakes and how to fix them. */
  mistakes?: { problem: string; fix: string }[];
  related?: string[];
  /** Extra words people might search for. */
  keywords?: string[];
}

export interface Faq {
  q: string;
  a: Block[];
  area: AreaKey;
  related?: string[];
}

export interface Term {
  term: string;
  def: string;
  see?: string;
}
