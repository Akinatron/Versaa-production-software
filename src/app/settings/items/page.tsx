import Link from "next/link";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { SettingsBack } from "../../components/settings-versions";
import { addItemAction, renameItemAction, setItemActiveAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [items, usedRows] = await Promise.all([
    db().select().from(t.items).where(inArray(t.items.kind, ["ingredient", "packaging"])),
    db().execute<{ item_id: string; name: string }>(sql`
      select l.item_id, s.name from recipe_lines l join recipe_versions v on v.id = l.recipe_version_id join sauces s on s.id = v.sauce_id
      where v.status = 'active'
      union
      select l.item_id, p.name from packaging_lines l join packaging_versions v on v.id = l.packaging_version_id join products p on p.id = v.product_id
      where v.status = 'active'`),
  ]);
  const usedBy = new Map<string, string[]>();
  for (const r of usedRows) usedBy.set(r.item_id, [...(usedBy.get(r.item_id) ?? []), r.name]);

  const groups = [
    { kind: "ingredient", title: "Ingredients" },
    { kind: "packaging", title: "Packaging items" },
  ] as const;

  return (
    <>
      <SettingsBack />
      <h1>Ingredients & packaging items</h1>
      <p className="lead">
        Everything you buy and keep in stock. Nothing is deleted: a retired item disappears from lists and new recipes, but its stock and history stay. The stock unit
        can't be changed after adding, so stock numbers stay comparable.
      </p>
      <Flash params={sp} />

      <h2>Add an item</h2>
      <div className="grid">
        <form action={addItemAction} className="card">
          <strong>New ingredient</strong>
          <input type="hidden" name="kind" value="ingredient" />
          <label htmlFor="iname" style={{ marginTop: 8 }}>
            Name (required)
          </label>
          <input id="iname" name="name" type="text" required />
          <label htmlFor="iunit" style={{ marginTop: 8 }}>
            Stock unit (required) — how you count and buy it
          </label>
          <select id="iunit" name="stockUnit" defaultValue="kg" required>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="L">L</option>
            <option value="ml">ml</option>
          </select>
          <div style={{ marginTop: 12 }}>
            <button type="submit">Add ingredient</button>
          </div>
        </form>
        <form action={addItemAction} className="card">
          <strong>New packaging item</strong>
          <input type="hidden" name="kind" value="packaging" />
          <input type="hidden" name="stockUnit" value="unit" />
          <label htmlFor="pname" style={{ marginTop: 8 }}>
            Name (required)
          </label>
          <input id="pname" name="name" type="text" required />
          <p className="small muted">Packaging is always counted in units (pieces).</p>
          <button type="submit">Add packaging item</button>
        </form>
      </div>

      {groups.map((g) => {
        const list = items.filter((i) => i.kind === g.kind).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
        return (
          <section key={g.kind}>
            <h2>
              {g.title} <span className="muted small">({list.filter((i) => i.active).length} in use)</span>
            </h2>
            <div className="card scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Stock unit</th>
                    <th>Status</th>
                    <th>Used by (active)</th>
                    <th>Rename</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => {
                    const used = usedBy.get(i.id) ?? [];
                    return (
                      <tr key={i.id} style={i.active ? undefined : { opacity: 0.7 }}>
                        <td>
                          <Link href={`/stock/${i.id}`}>{i.name}</Link>
                        </td>
                        <td>{UNITS[i.stockUnit as UnitCode].label}</td>
                        <td>{i.active ? <span className="badge ok">In use</span> : <span className="badge">Retired</span>}</td>
                        <td className="small">{used.length ? used.join(", ") : <span className="muted">—</span>}</td>
                        <td>
                          <form action={renameItemAction} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                            <input type="hidden" name="itemId" value={i.id} />
                            <input name="name" type="text" defaultValue={i.name} required aria-label={`New name for ${i.name}`} style={{ minWidth: 140 }} />
                            <button type="submit" style={{ padding: "6px 12px", background: "var(--muted)" }}>
                              Rename
                            </button>
                          </form>
                        </td>
                        <td>
                          <form action={setItemActiveAction}>
                            <input type="hidden" name="itemId" value={i.id} />
                            <input type="hidden" name="active" value={i.active ? "0" : "1"} />
                            <button type="submit" style={{ padding: "6px 12px", background: i.active ? "var(--bad)" : "var(--ok)" }} title={i.active && used.length ? "Remove it from the recipes/lists above first" : undefined}>
                              {i.active ? "Retire" : "Bring back"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="small muted">An item still used by an active recipe or packaging list can't be retired: make a new version without it first.</p>
    </>
  );
}
