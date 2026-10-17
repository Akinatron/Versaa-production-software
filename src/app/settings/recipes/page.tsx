import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { SettingsBack, VERSION_STATUS, fmtDate } from "../../components/settings-versions";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const [sauces, versions, lines] = await Promise.all([
    db().select().from(t.sauces).orderBy(asc(t.sauces.name)),
    db().select().from(t.recipeVersions),
    db().select({ v: t.recipeLines.recipeVersionId }).from(t.recipeLines),
  ]);
  const count = (id: string) => lines.filter((l) => l.v === id).length;

  return (
    <>
      <SettingsBack />
      <h1>Recipes</h1>
      <p className="lead">
        One active recipe per sauce, for one reference batch. To change a recipe you make a new version; batches already made keep the version they used.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Sauce</th>
              <th>Active version</th>
              <th className="num">Ingredients</th>
              <th>Batch size</th>
              <th>Draft</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sauces.map((s) => {
              const own = versions.filter((v) => v.sauceId === s.id);
              const active = own.find((v) => v.status === "active");
              const draft = own.find((v) => v.status === "draft");
              return (
                <tr key={s.id}>
                  <td>
                    {s.name} {!s.active && <span className="badge">Retired sauce</span>}
                  </td>
                  <td>{active ? `v${active.versionNo} · since ${fmtDate(active.activatedAt)}` : <span className="badge bad">No active recipe</span>}</td>
                  <td className="num">{active ? count(active.id) : "—"}</td>
                  <td>{active ? `${active.batchReferenceKg} kg` : "—"}</td>
                  <td>{draft ? <span className={`badge ${VERSION_STATUS.draft!.cls}`}>v{draft.versionNo} draft</span> : <span className="muted">—</span>}</td>
                  <td>
                    <Link href={`/settings/recipes/${s.id}`}>{active ? "Open" : "Set up"} →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
