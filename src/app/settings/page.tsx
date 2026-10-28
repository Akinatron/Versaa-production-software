import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { isBoughtKind } from "@/domain/item-kinds";
import { loadPlanCatalog } from "@/db/planning";
import { Flash } from "../components/flash";
import { PageHeader } from "../components/ui/header";
import { AppUpdates } from "./app-updates";
import { activeMock } from "@/db/client";
import { wipeCounts } from "@/db/wipe";
import { devToolsBuilt, isDeveloperMode } from "@/lib/developer";
import { DeleteDatabase, EnterDeveloperMode } from "./developer-dialogs";
import { leaveDeveloperModeAction, startMockAction, stopMockAction } from "./developer-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, drafts, items, devMode] = await Promise.all([
    loadPlanCatalog(db()),
    db().execute<{ n: number; kind: string }>(
      // Open drafts, so nobody forgets a half-finished change.
      sql`select 'recipe' as kind, count(*)::int as n from recipe_versions where status = 'draft'
        union all select 'packaging', count(*)::int from packaging_versions where status = 'draft'`,
    ),
    db().select().from(t.items),
    isDeveloperMode(),
  ]);
  const draftCount = (k: string) => [...drafts].find((d) => d.kind === k)?.n ?? 0;
  const noRecipe = catalog.sauces.filter((s) => !s.recipe);
  const noPackaging = catalog.products.filter((p) => p.packaging.length === 0);
  const noYield = catalog.sauces.filter((s) => s.yield.litresPerBatch === null);
  const estimated = catalog.sauces.filter((s) => s.yield.source === "estimate");
  const activeItems = items.filter((i) => i.active && isBoughtKind(i.kind));
  const nOf = (kind: string) => activeItems.filter((i) => i.kind === kind).length;

  const sections: {
    href: string;
    title: string;
    text: string;
    status: { cls: string; text: string };
  }[] = [
    {
      href: "/settings/recipes",
      title: "Recipes",
      text: "Ingredients and quantities per batch. Changes are saved as a new version.",
      status:
        noRecipe.length > 0
          ? {
              cls: "bad",
              text: `${noRecipe.map((s) => s.name).join(", ")}: no active recipe`,
            }
          : draftCount("recipe") > 0
            ? {
                cls: "warn",
                text: `${draftCount("recipe")} draft not activated yet`,
              }
            : { cls: "ok", text: `${catalog.sauces.length} recipes active` },
    },
    {
      href: "/settings/packaging",
      title: "Packaging per product",
      text: "Jar, lid, labels and other items used for each filled jar.",
      status:
        noPackaging.length > 0
          ? {
              cls: "bad",
              text: `${noPackaging.length} product(s) without a packaging list`,
            }
          : draftCount("packaging") > 0
            ? {
                cls: "warn",
                text: `${draftCount("packaging")} draft not activated yet`,
              }
            : {
                cls: "ok",
                text: `${catalog.products.length} packaging lists active`,
              },
    },
    {
      href: "/settings/items",
      title: "Items",
      text: "The things you buy and keep in stock (ingredients, packaging and other), with each supplier's price.",
      status: {
        cls: "",
        text: `${nOf("ingredient")} ingredients · ${nOf("packaging")} packaging · ${nOf("other")} other`,
      },
    },
    {
      href: "/settings/catalog",
      title: "Sauces, sizes & products",
      text: "What you make and sell: sauces, jar sizes (fill per jar) and sauce × size products.",
      status: {
        cls: "",
        text: `${catalog.sauces.length} sauces · ${catalog.products.length} products in use`,
      },
    },
    {
      href: "/settings/yields",
      title: "Yields & rejects",
      text: "Litres per batch and reject rates the planner uses. Recorded batches replace estimates automatically.",
      status:
        noYield.length > 0
          ? {
              cls: "bad",
              text: `${noYield.length} sauce(s) without a litres-per-batch figure`,
            }
          : estimated.length > 0
            ? {
                cls: "warn",
                text: `${estimated.length} sauce(s) still planned with an estimate`,
              }
            : { cls: "ok", text: "All yields measured from recorded batches" },
    },
  ];

  return (
    <>
      <PageHeader title="Settings" />
      <Flash params={params} />

      <nav className="linklist card" aria-label="Settings">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <span className={`dot ${s.status.cls || "neutral"}`} aria-hidden />
            <span className="what">
              <strong>{s.title}</strong>
              <span className="sub">{s.text}</span>
            </span>
            <span className={`state small ${s.status.cls ? `text-${s.status.cls}` : "muted"}`}>{s.status.text}</span>
            <span className="chev" aria-hidden />
          </Link>
        ))}
      </nav>

      {devToolsBuilt() && (devMode ? <DeveloperTools /> : <DeveloperOff />)}
    </>
  );
}

function DeveloperOff() {
  return (
    <section className="dev-off" id="developer">
      <div>
        <strong>Developer mode</strong>
        <p className="small muted">Testing tools: check for updates, mock data and delete database. Off in daily use.</p>
      </div>
      <EnterDeveloperMode />
    </section>
  );
}

async function DeveloperTools() {
  const mock = activeMock();
  const counts = await wipeCounts(db());
  return (
    <section id="developer" className="dev-panel" aria-labelledby="dev-heading">
      <div className="dev-banner" role="status">
        <strong id="dev-heading">Developer mode is on</strong>
        <form action={leaveDeveloperModeAction}>
          <button type="submit" className="secondary sm">
            Back to normal mode
          </button>
        </form>
      </div>

      <AppUpdates />

      <section className="card" aria-labelledby="mock-title">
        <h3 id="mock-title">Mock data</h3>
        {mock ? (
          <>
            <p className="small">
              <strong>On.</strong> The app shows a separate test database: four test suppliers with different prices for the same items, and an example of every
              stage (runs, orders, deliveries, batches, stock, outbound, corrections). Your real data is not touched. Whatever you change now is thrown away
              when you turn it off, or when the app closes.
            </p>
            <form action={stopMockAction}>
              <button type="submit" className="secondary">
                Turn off and go back to real data
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="small muted">
              Look at the app with test data in a separate database. Your real data is not touched, and nothing you change in mock data is kept. Takes a few
              seconds to build.
            </p>
            <form action={startMockAction}>
              <button type="submit">Show mock data</button>
            </form>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="wipe-title">
        <h3 id="wipe-title">Delete database</h3>
        <p className="small muted">
          Choose what to delete from the {mock ? "mock" : "real"} database: activity, suppliers, recipes, items, or the sauces and products themselves.
        </p>
        <DeleteDatabase counts={counts} mock={!!mock} />
      </section>
    </section>
  );
}
