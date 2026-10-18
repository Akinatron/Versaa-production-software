import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { Flash } from "../../../components/flash";
import { DefaultSubmit, VERSION_STATUS, VersionHistory, fmtDate } from "../../../components/settings-versions";
import { activatePackaging, discardPackaging, savePackaging, startPackaging } from "../../actions";
import { PageHeader } from "../../../components/ui/header";

export const dynamic = "force-dynamic";

type Line = typeof t.packagingLines.$inferSelect;
type Item = typeof t.items.$inferSelect;

export default async function PackagingPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { productId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(productId)) notFound();
  const [row] = await db()
    .select({ p: t.products, f: t.formats })
    .from(t.products)
    .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
    .where(eq(t.products.id, productId));
  if (!row) notFound();
  const { p: product, f: format } = row;

  const versions = await db()
    .select()
    .from(t.packagingVersions)
    .where(eq(t.packagingVersions.productId, productId))
    .orderBy(desc(t.packagingVersions.versionNo));
  const ids = versions.map((v) => v.id);
  const [lines, items, used] = await Promise.all([
    ids.length ? db().select().from(t.packagingLines).where(inArray(t.packagingLines.packagingVersionId, ids)) : Promise.resolve([] as Line[]),
    db().select().from(t.items).where(eq(t.items.kind, "packaging")),
    ids.length
      ? db()
          .select({
            v: t.packagingSessionLines.packagingVersionId,
            n: sql<number>`count(*)::int`,
          })
          .from(t.packagingSessionLines)
          .where(inArray(t.packagingSessionLines.packagingVersionId, ids))
          .groupBy(t.packagingSessionLines.packagingVersionId)
      : Promise.resolve([] as { v: string | null; n: number }[]),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const name = (id: string) => itemById.get(id)?.name ?? "?";
  const linesOf = (id: string) => lines.filter((l) => l.packagingVersionId === id).sort((a, b) => name(a.itemId).localeCompare(name(b.itemId)));
  const active = versions.find((v) => v.status === "active");
  const draft = versions.find((v) => v.status === "draft");
  const viewing = sp.v ? versions.find((v) => v.id === sp.v) : undefined;
  const extra = Math.max(1, Math.min(20, Number(sp.extra) || 2));
  const back = `/settings/packaging/${productId}`;

  return (
    <>
      <PageHeader
        back={{ href: "/settings/packaging", label: "Packaging" }}
        title={<>Packaging: {product.name}</>}
        lead={
          <>
            Items used for each filled jar of {format.name} (fill {format.fillMl} ml). A change is made as a new version: jars already packed keep the list they
            used.
          </>
        }
      />
      <Flash params={sp} />

      {!draft && (
        <form action={startPackaging} className="card row" style={{ alignItems: "center" }}>
          <input type="hidden" name="productId" value={product.id} />
          <button type="submit">{active ? "Change packaging list" : "Set up packaging list"}</button>
          <span className="small muted" style={{ flex: 1, minWidth: 220 }}>
            {active
              ? `Starts a draft copied from v${active.versionNo}. Nothing changes until you activate it.`
              : "Starts an empty draft. This product can't be planned or packed until a packaging list is active."}
          </span>
        </form>
      )}

      {draft && (
        <section id="editor">
          <h2>
            Draft v{draft.versionNo} <span className={`badge ${VERSION_STATUS.draft!.cls}`}>{VERSION_STATUS.draft!.label}</span>
          </h2>
          {sp.confirm === "1" ? (
            <Confirm
              draft={draft}
              draftLines={linesOf(draft.id)}
              activeLines={active ? linesOf(active.id) : []}
              activeNo={active?.versionNo}
              name={name}
              productId={product.id}
              back={back}
            />
          ) : (
            <>
              <form action={savePackaging} className="card">
                <DefaultSubmit name="intent" value="save" />
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <input type="hidden" name="extra" value={extra} />
                <p className="small muted" style={{ marginTop: 0 }}>
                  Choose each packaging item and how many one filled jar uses (a whole number). Leave a row empty to ignore it.
                </p>
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Packaging item</th>
                        <th>Per jar</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...linesOf(draft.id), ...Array.from({ length: extra }, () => null)].map((l, i) => (
                        <tr key={i}>
                          <td className="muted">{i + 1}</td>
                          <td style={{ minWidth: 200 }}>
                            <select name={`item_${i}`} defaultValue={l?.itemId ?? ""} aria-label={`Packaging item, row ${i + 1}`}>
                              <option value="">— choose —</option>
                              {[...items]
                                .filter((x) => x.active || x.id === l?.itemId)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            <input
                              name={`perJar_${i}`}
                              type="number"
                              min="1"
                              step="1"
                              inputMode="numeric"
                              defaultValue={l?.perJar ?? ""}
                              aria-label={`Per jar, row ${i + 1}`}
                            />
                          </td>
                          <td>
                            {l && (
                              <button type="submit" name="intent" value={`remove:${i}`} className="secondary sm">
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="submit" name="intent" value="addrow" className="secondary">
                    + Add row
                  </button>
                  <span className="small muted">Saves the draft and adds an empty row.</span>
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="submit" name="intent" value="save">
                    Save draft
                  </button>
                  <button type="submit" name="intent" value="activate">
                    Save and activate…
                  </button>
                </div>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  Saving keeps the draft for later; plans and packaging still use {active ? `v${active.versionNo}` : "no list"}. Activating asks you to confirm
                  first.
                </p>
              </form>
              <form action={discardPackaging} className="row" style={{ alignItems: "center", marginBottom: 16 }}>
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <button type="submit" className="danger sm">
                  Discard draft
                </button>
                <span className="small muted">Throws this draft away. The active list stays as it is.</span>
              </form>
            </>
          )}
        </section>
      )}

      {viewing && viewing.status === "retired" && (
        <>
          <h2>
            Viewing v{viewing.versionNo} <span className="badge">Retired</span>
          </h2>
          <ListCard lines={linesOf(viewing.id)} name={name} itemById={itemById} meta={`v${viewing.versionNo} · activated ${fmtDate(viewing.activatedAt)}`} />
          <p className="small">
            <Link href={back}>Hide</Link>
          </p>
        </>
      )}

      <h2>Active packaging list</h2>
      {active ? (
        <ListCard lines={linesOf(active.id)} name={name} itemById={itemById} meta={`v${active.versionNo} · activated ${fmtDate(active.activatedAt)}`} />
      ) : (
        <p className="card">
          <span className="badge bad">No packaging list</span> {product.name} can't be planned or packed until one is activated.
        </p>
      )}

      <h2>Version history</h2>
      {versions.length === 0 ? (
        <p className="card muted">No versions yet.</p>
      ) : (
        <VersionHistory
          versions={versions.map((v) => ({
            ...v,
            lines: linesOf(v.id).length,
            used: used.find((u) => u.v === v.id)?.n ?? 0,
          }))}
          viewHref={(id) => (id === draft?.id ? `${back}#editor` : id === active?.id ? back : `${back}?v=${id}`)}
          usedLabel="Times packed"
          current={viewing?.id}
        />
      )}
    </>
  );
}

function ListCard({ lines, name, itemById, meta }: { lines: Line[]; name: (id: string) => string; itemById: Map<string, Item>; meta: string }) {
  return (
    <div className="card scroll">
      <p className="small muted" style={{ marginTop: 0 }}>
        {meta}
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Per filled jar</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>
                {name(l.itemId)} {itemById.get(l.itemId)?.active === false && <span className="badge">retired item</span>}
              </td>
              <td className="num">{l.perJar}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Confirm({
  draft,
  draftLines,
  activeLines,
  activeNo,
  name,
  productId,
  back,
}: {
  draft: typeof t.packagingVersions.$inferSelect;
  draftLines: Line[];
  activeLines: Line[];
  activeNo?: number;
  name: (id: string) => string;
  productId: string;
  back: string;
}) {
  const changes: string[] = [];
  for (const d of draftLines) {
    const a = activeLines.find((x) => x.itemId === d.itemId);
    if (!a) changes.push(`Added ${name(d.itemId)}: ${d.perJar} per jar`);
    else if (a.perJar !== d.perJar) changes.push(`${name(d.itemId)}: ${a.perJar} → ${d.perJar} per jar`);
  }
  for (const a of activeLines) if (!draftLines.some((d) => d.itemId === a.itemId)) changes.push(`Removed ${name(a.itemId)}`);
  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <strong>Activate v{draft.versionNo}?</strong>
      <p style={{ margin: "8px 0" }}>Jars already packed keep the list they used. New plans and packaging use this version.</p>
      {activeNo ? (
        <>
          <p className="small muted" style={{ margin: "0 0 4px" }}>
            Changes compared with v{activeNo} (which will be retired):
          </p>
          {changes.length ? (
            <ul style={{ marginTop: 0 }}>
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="small">
              <span className="badge warn">No changes</span> The draft is the same as v{activeNo}.
            </p>
          )}
        </>
      ) : (
        <p className="small muted">This becomes the first packaging list for this product.</p>
      )}
      <div className="row" style={{ alignItems: "center" }}>
        <form action={activatePackaging}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="versionId" value={draft.id} />
          <button type="submit">Activate v{draft.versionNo}</button>
        </form>
        <Link href={`${back}#editor`}>Back to editing</Link>
      </div>
    </div>
  );
}
