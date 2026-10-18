import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { Flash } from "../components/flash";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, suppliers, drafts, items] = await Promise.all([
    loadPlanCatalog(db()),
    db().select().from(t.suppliers).orderBy(asc(t.suppliers.name)),
    db().execute<{ n: number; kind: string }>(
      // Open drafts, so nobody forgets a half-finished change.
      sql`select 'recipe' as kind, count(*)::int as n from recipe_versions where status = 'draft'
        union all select 'packaging', count(*)::int from packaging_versions where status = 'draft'`,
    ),
    db().select().from(t.items),
  ]);
  const draftCount = (k: string) => [...drafts].find((d) => d.kind === k)?.n ?? 0;
  const noRecipe = catalog.sauces.filter((s) => !s.recipe);
  const noPackaging = catalog.products.filter((p) => p.packaging.length === 0);
  const noYield = catalog.sauces.filter((s) => s.yield.litresPerBatch === null);
  const estimated = catalog.sauces.filter((s) => s.yield.source === "estimate");
  const activeItems = items.filter((i) => i.active && (i.kind === "ingredient" || i.kind === "packaging"));

  const sections: { href: string; title: string; text: string; status: { cls: string; text: string } }[] = [
    {
      href: "/settings/recipes",
      title: "Recipes",
      text: "Ingredients and quantities per batch. Changes are saved as a new version.",
      status:
        noRecipe.length > 0
          ? { cls: "bad", text: `${noRecipe.map((s) => s.name).join(", ")}: no active recipe` }
          : draftCount("recipe") > 0
            ? { cls: "warn", text: `${draftCount("recipe")} draft not activated yet` }
            : { cls: "ok", text: `${catalog.sauces.length} recipes active` },
    },
    {
      href: "/settings/packaging",
      title: "Packaging per product",
      text: "Jar, lid, labels and other items used for each filled jar.",
      status:
        noPackaging.length > 0
          ? { cls: "bad", text: `${noPackaging.length} product(s) without a packaging list` }
          : draftCount("packaging") > 0
            ? { cls: "warn", text: `${draftCount("packaging")} draft not activated yet` }
            : { cls: "ok", text: `${catalog.products.length} packaging lists active` },
    },
    {
      href: "/settings/items",
      title: "Ingredients & packaging items",
      text: "The things you buy and keep in stock: add, rename, retire.",
      status: { cls: "", text: `${activeItems.filter((i) => i.kind === "ingredient").length} ingredients · ${activeItems.filter((i) => i.kind === "packaging").length} packaging items` },
    },
    {
      href: "/settings/catalog",
      title: "Sauces, sizes & products",
      text: "What you make and sell: sauces, jar sizes (fill per jar) and sauce × size products.",
      status: { cls: "", text: `${catalog.sauces.length} sauces · ${catalog.products.length} products in use` },
    },
    {
      href: "/settings/yields",
      title: "Yields & rejects",
      text: "Litres per batch and reject rates the planner uses. Recorded batches replace estimates automatically.",
      status:
        noYield.length > 0
          ? { cls: "bad", text: `${noYield.length} sauce(s) without a litres-per-batch figure` }
          : estimated.length > 0
            ? { cls: "warn", text: `${estimated.length} sauce(s) still planned with an estimate` }
            : { cls: "ok", text: "All yields measured from recorded batches" },
    },
    {
      href: "/suppliers",
      title: "Suppliers",
      text: "Who you buy from, what each one sells, pack sizes and prices.",
      status: { cls: "", text: `${suppliers.length} supplier(s)` },
    },
  ];

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Recipes, packaging, products and planning figures. These change rarely; daily work happens elsewhere.</p>
      <Flash params={params} />

      <div className="grid">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="card" style={{ color: "inherit", textDecoration: "none", marginBottom: 0 }}>
            <strong>{s.title} →</strong>
            <p className="muted small" style={{ margin: "4px 0 8px" }}>
              {s.text}
            </p>
            <span className={`badge ${s.status.cls}`}>{s.status.text}</span>
          </Link>
        ))}
      </div>

    </>
  );
}
