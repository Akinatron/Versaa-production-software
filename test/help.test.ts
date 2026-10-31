import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ARTICLES, AREAS, FAQ, GLOSSARY, getArticle } from "@/help/index";
import { SCREEN_HELP, helpSlugFor } from "@/help/screens";
import { buildManual } from "@/help/manual";
import { parseInline, toManualText } from "@/help/inline";
import { searchEntries } from "@/help/search";
import type { Block } from "@/help/types";

const APP = path.resolve(import.meta.dirname, "../src/app");

/** Every screen of the app, as a route like /runs/[id]/order. */
function routes(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full, `${prefix}/${name}`));
    else if (name === "page.tsx") out.push(prefix || "/");
  }
  return out;
}

/** Every piece of text in the help, for checks that apply to all of it. */
function allText(): string[] {
  const blocks = (b: Block): string[] =>
    typeof b === "string"
      ? [b]
      : "h" in b
        ? [b.h]
        : "ul" in b
          ? b.ul
          : "ol" in b
            ? b.ol
            : "note" in b
              ? [b.note]
              : "flow" in b
                ? b.flow
                : [...b.table.head, ...b.table.rows.flat()];
  return [
    ...ARTICLES.flatMap((a) => [
      a.title,
      a.summary,
      ...(a.keywords ?? []),
      ...(a.before ?? []),
      ...(a.steps ?? []),
      ...(a.changes ?? []),
      ...(a.more ?? []).flatMap(blocks),
      ...(a.mistakes ?? []).flatMap((m) => [m.problem, m.fix]),
    ]),
    ...FAQ.flatMap((f) => [f.q, ...f.a.flatMap(blocks)]),
    ...GLOSSARY.flatMap((g) => [g.term, g.def]),
  ];
}

describe("help content", () => {
  it("has a guide for every screen of the app", () => {
    const listed = new Set(SCREEN_HELP.map(([r]) => r));
    const screens = routes().filter((r) => !r.startsWith("/help"));
    expect(screens.filter((r) => !listed.has(r))).toEqual([]);
    // …and lists no screen that no longer exists.
    expect([...listed].filter((r) => !screens.includes(r))).toEqual([]);
  });

  it("points every screen, related link and help: link at a real guide", () => {
    const missing: string[] = [];
    for (const [route, slug] of SCREEN_HELP) if (!getArticle(slug)) missing.push(`${route} → ${slug}`);
    for (const a of ARTICLES) for (const r of a.related ?? []) if (!getArticle(r)) missing.push(`${a.slug} related ${r}`);
    for (const f of FAQ) for (const r of f.related ?? []) if (!getArticle(r)) missing.push(`FAQ related ${r}`);
    for (const g of GLOSSARY) if (g.see && !getArticle(g.see)) missing.push(`term ${g.term} → ${g.see}`);
    for (const text of allText())
      for (const p of parseInline(text)) if (p.t === "link" && p.href.startsWith("help:") && !getArticle(p.href.slice(5))) missing.push(`link ${p.href}`);
    expect(missing).toEqual([]);
  });

  it("links only to screens that exist", () => {
    const patterns = routes().map((r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`));
    const bad: string[] = [];
    const check = (href: string) => {
      if (href.startsWith("help:")) return;
      const p = href.split(/[?#]/)[0]!;
      if (!patterns.some((re) => re.test(p))) bad.push(href);
    };
    for (const text of allText()) for (const p of parseInline(text)) if (p.t === "link") check(p.href);
    for (const a of ARTICLES) if (a.go) check(a.go.href);
    expect(bad).toEqual([]);
  });

  it("has unique slugs, a known area and something to read in every guide", () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const areas = new Set(AREAS.map((a) => a.key));
    for (const a of ARTICLES) {
      expect(areas.has(a.area), a.slug).toBe(true);
      expect((a.steps?.length ?? 0) + (a.more?.length ?? 0), a.slug).toBeGreaterThan(0);
    }
  });

  it("is about this app only: Windows-first, no Mac app, English", () => {
    const text = allText().join("\n");
    expect(text).not.toMatch(/\bmac(os)?\b|numbers app|finder|terminal|pnpm/i);
    expect(text).not.toMatch(/[áéíóúñ¿¡]/i);
    expect(text).not.toMatch(/\b(albaran|pedidos?|clientes?|caducidad|rendimiento|lotes?|recetas?|tarros?|proveedor(es)?|entregas?|salsas?)\b/i);
  });

  it("maps screen addresses to their guide", () => {
    expect(helpSlugFor("/")).toBe("today");
    expect(helpSlugFor("/batches/0b7c/pack")).toBe("pack-batch");
    expect(helpSlugFor("/runs/abc/order")).toBe("order-whats-missing");
    expect(helpSlugFor("/help/runs")).toBeNull();
    expect(helpSlugFor("/nowhere")).toBeNull();
  });
});

describe("AI manual", () => {
  it("holds every guide, question and term, without app addresses", () => {
    const md = buildManual({ generatedOn: "2026-10-28" });
    for (const a of ARTICLES) expect(md).toContain(`### ${a.title}`);
    for (const f of FAQ) expect(md).toContain(`### ${f.q}`);
    for (const g of GLOSSARY) expect(md).toContain(`**${g.term}**`);
    expect(md).toContain("For the AI assistant reading this");
    expect(md).not.toMatch(/\]\((\/|help:)/);
    expect(md).not.toMatch(/undefined|\[object Object\]/);
    expect(md).not.toContain("Your current setup");
  });

  it("adds the current setup only when asked", () => {
    const md = buildManual({ generatedOn: "2026-10-28", setup: "### Sauces\n\nBolognese" });
    expect(md).toContain("Your current setup");
    expect(md).toContain("Bolognese");
  });

  it("drops link addresses but keeps the words", () => {
    expect(toManualText("Open [Stock](/stock) and see [this](help:stock).")).toBe("Open Stock and see this.");
  });
});

describe("help search", () => {
  it("finds guides by words in their steps", () => {
    const hit = searchEntries().filter((e) => ["refused", "delivery"].every((w) => e.text.includes(w)));
    expect(hit.some((e) => e.href === "/help/record-delivery")).toBe(true);
  });
});
