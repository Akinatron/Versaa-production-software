import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { Flash } from "../../components/flash";
import {
  addFormatAction,
  addProductAction,
  addSauceAction,
  setFormatActiveAction,
  setFormatFillAction,
  setProductActiveAction,
  setSauceActiveAction,
  setSauceColorAction,
} from "../actions";
import { PageHeader } from "../../components/ui/header";
import { SauceName } from "../../components/sauce-name";
import { SAUCE_COLORS } from "@/domain/sauce-colors";

export const dynamic = "force-dynamic";

const small = { padding: "6px 12px" } as const;

function Toggle({ action, idName, id, active }: { action: (f: FormData) => Promise<void>; idName: string; id: string; active: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button type="submit" style={{ ...small, background: active ? "var(--bad)" : "var(--ok)" }}>
        {active ? "Retire" : "Bring back"}
      </button>
    </form>
  );
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [sauces, formats, products, recipes, pkgs] = await Promise.all([
    db().select().from(t.sauces).orderBy(asc(t.sauces.name)),
    db().select().from(t.formats).orderBy(desc(t.formats.capacityMl)),
    db().select().from(t.products),
    db().select().from(t.recipeVersions),
    db().select().from(t.packagingVersions),
  ]);
  const sauceName = new Map(sauces.map((s) => [s.id, s]));
  const formatOf = new Map(formats.map((f) => [f.id, f]));
  const sortedProducts = [...products].sort(
    (a, b) =>
      (sauceName.get(a.sauceId)?.name ?? "").localeCompare(sauceName.get(b.sauceId)?.name ?? "") ||
      (formatOf.get(b.formatId)?.capacityMl ?? 0) - (formatOf.get(a.formatId)?.capacityMl ?? 0),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Sauces, sizes & products"
        lead={
          <>A product is one sauce in one jar size. Nothing is deleted: retiring takes something out of plans and lists, but keeps its history and stock.</>
        }
      />
      <Flash params={sp} />

      <h2>Sauces</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Sauce</th>
              <th>Colour</th>
              <th>Batch numbers</th>
              <th>Recipe</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sauces.map((s) => {
              const active = recipes.find((r) => r.sauceId === s.id && r.status === "active");
              return (
                <tr key={s.id}>
                  <td>
                    <SauceName name={s.name} color={s.color} />
                  </td>
                  <td>
                    <form action={setSauceColorAction} className="swatches" aria-label={`Colour for ${s.name}`}>
                      <input type="hidden" name="sauceId" value={s.id} />
                      {SAUCE_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="submit"
                          name="color"
                          value={c.key}
                          className={`sc-${c.key}`}
                          title={c.label}
                          aria-label={c.label}
                          aria-pressed={s.color === c.key}
                        />
                      ))}
                    </form>
                  </td>
                  <td>
                    <code>{s.batchPrefix}</code>-YYYYMMDD-01
                  </td>
                  <td>
                    <Link href={`/settings/recipes/${s.id}`}>{active ? `v${active.versionNo}` : <span className="badge bad">No recipe — set up</span>}</Link>
                  </td>
                  <td>{s.active ? <span className="badge ok">In use</span> : <span className="badge">Retired</span>}</td>
                  <td>
                    <Toggle action={setSauceActiveAction} idName="sauceId" id={s.id} active={s.active} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={addSauceAction} className="row" style={{ marginTop: 12 }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="sname">New sauce name (required)</label>
            <input id="sname" name="name" type="text" required placeholder="e.g. Surinaamse Pom" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="sprefix">Batch-number prefix (optional, max 5 letters)</label>
            <input id="sprefix" name="batchPrefix" type="text" maxLength={5} placeholder="automatic" style={{ textTransform: "uppercase" }} />
          </div>
          <button type="submit">Add sauce</button>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Left empty, the prefix is the first 3 letters of the second word (Tikka → TIK). A new sauce needs a recipe, a yield estimate and products before it
          can be planned.
        </p>
      </div>

      <h2>Jar sizes</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th className="num">Capacity</th>
              <th className="num">Fill per jar</th>
              <th>Change fill</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {formats.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="num">{f.capacityMl} ml</td>
                <td className="num">{f.fillMl} ml</td>
                <td>
                  <form action={setFormatFillAction} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                    <input type="hidden" name="formatId" value={f.id} />
                    <input
                      name="fillMl"
                      type="number"
                      min={1}
                      max={f.capacityMl}
                      step={1}
                      defaultValue={f.fillMl}
                      required
                      aria-label={`New fill for ${f.name} in ml`}
                    />
                    <button type="submit" className="secondary sm">
                      Set
                    </button>
                  </form>
                </td>
                <td>{f.active ? <span className="badge ok">In use</span> : <span className="badge">Retired</span>}</td>
                <td>
                  <Toggle action={setFormatActiveAction} idName="formatId" id={f.id} active={f.active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">A new fill applies to future plans and packaging; past packaging keeps the fill it used.</p>
        <form action={addFormatAction} className="row">
          <div style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="fname">New size name (required)</label>
            <input id="fname" name="name" type="text" required placeholder="e.g. 350 ml" />
          </div>
          <div>
            <label htmlFor="fcap">Capacity, ml (required)</label>
            <input id="fcap" name="capacityMl" type="number" min={1} step={1} required />
          </div>
          <div>
            <label htmlFor="ffill">Fill, ml (optional)</label>
            <input id="ffill" name="fillMl" type="number" min={1} step={1} placeholder="= capacity" />
          </div>
          <button type="submit">Add size</button>
        </form>
      </div>

      <h2>Products</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Packaging list</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((p) => {
              const active = pkgs.find((v) => v.productId === p.id && v.status === "active");
              const s = sauceName.get(p.sauceId);
              const f = formatOf.get(p.formatId);
              const blocked = (s && !s.active) || (f && !f.active);
              return (
                <tr key={p.id}>
                  <td>
                    <SauceName name={p.name} color={s?.color} />
                    {blocked && <div className="small muted">Not planned: its {s && !s.active ? "sauce" : "size"} is retired.</div>}
                  </td>
                  <td>
                    <Link href={`/settings/packaging/${p.id}`}>
                      {active ? `v${active.versionNo}` : <span className="badge bad">None — needed before planning</span>}
                    </Link>
                  </td>
                  <td>{p.active ? <span className="badge ok">In use</span> : <span className="badge">Retired</span>}</td>
                  <td>
                    <Toggle action={setProductActiveAction} idName="productId" id={p.id} active={p.active} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={addProductAction} className="row" style={{ marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="psauce">Sauce (required)</label>
            <select id="psauce" name="sauceId" required defaultValue="">
              <option value="">— choose —</option>
              {sauces
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="pformat">Size (required)</label>
            <select id="pformat" name="formatId" required defaultValue="">
              <option value="">— choose —</option>
              {formats
                .filter((f) => f.active)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>
          <button type="submit">Add product</button>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>
          A new product needs a packaging list before it can be planned; you'll be taken there after adding it. Adding a product that was retired brings it
          back.
        </p>
      </div>
    </>
  );
}
