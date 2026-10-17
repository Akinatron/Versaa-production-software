import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { SettingsBack, fmtDate } from "../../components/settings-versions";

export const dynamic = "force-dynamic";

export default async function PackagingListPage() {
  const [products, versions, lines, items] = await Promise.all([
    db()
      .select({ p: t.products, s: t.sauces, f: t.formats })
      .from(t.products)
      .innerJoin(t.sauces, eq(t.products.sauceId, t.sauces.id))
      .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
      .orderBy(asc(t.sauces.name), asc(t.formats.capacityMl)),
    db().select().from(t.packagingVersions),
    db().select().from(t.packagingLines),
    db().select().from(t.items).where(eq(t.items.kind, "packaging")),
  ]);
  const name = new Map(items.map((i) => [i.id, i.name]));
  const sorted = [...products].sort((a, b) => a.s.name.localeCompare(b.s.name) || b.f.capacityMl - a.f.capacityMl);

  return (
    <>
      <SettingsBack />
      <h1>Packaging per product</h1>
      <p className="lead">
        What each filled jar uses. Packaging materials are taken from stock for every filled jar, rejected ones included. A product can only be planned once it
        has an active packaging list.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Active list</th>
              <th>Uses per jar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ p }) => {
              const own = versions.filter((v) => v.productId === p.id);
              const active = own.find((v) => v.status === "active");
              const draft = own.find((v) => v.status === "draft");
              const ls = active ? lines.filter((l) => l.packagingVersionId === active.id) : [];
              return (
                <tr key={p.id}>
                  <td>
                    {p.name} {!p.active && <span className="badge">Retired</span>}
                  </td>
                  <td>
                    {active ? `v${active.versionNo} · since ${fmtDate(active.activatedAt)}` : <span className="badge bad">No packaging list — can't be planned</span>}
                    {draft && (
                      <>
                        {" "}
                        <span className="badge warn">v{draft.versionNo} draft</span>
                      </>
                    )}
                  </td>
                  <td className="small">{ls.map((l) => `${l.perJar} × ${name.get(l.itemId) ?? "?"}`).join(", ") || "—"}</td>
                  <td>
                    <Link href={`/settings/packaging/${p.id}`}>{active ? "Open" : "Set up"} →</Link>
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
