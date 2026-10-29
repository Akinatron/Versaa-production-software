import Link from "next/link";
import { db } from "@/db/client";
import { AREAS, linksOf, listChanges } from "@/db/changes";
import { PageHeader, Empty } from "../components/ui/header";
import { ACTION_LABEL, AREA_LABEL, openHref, refLabel, toRow } from "../components/history-format";
import { ChangeItem } from "../components/history-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "History" };

const PAGE = 100;

/** Every change in the app, newest first: what was done, when, from what to what, and why. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const area = sp.area && (AREAS as string[]).includes(sp.area) ? sp.area : null;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : null;
  const filter = { area, action: sp.action || null, from: sp.from || null, to: sp.to || null, code: sp.code || null };
  const beforeId = before && sp.beforeId && /^[0-9a-f-]{36}$/i.test(sp.beforeId) ? sp.beforeId : null;
  const rows = await listChanges(db(), { ...filter, before, beforeId, limit: PAGE + 1 });
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const links = await linksOf(db(), page.map((c) => c.id));

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filter, area, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/history?${s}` : "/history";
  };
  const filtered = Object.values(filter).some(Boolean);

  return (
    <>
      <PageHeader title="History" />
      <nav className="tabs" aria-label="Area">
        <Link href={href({ area: null })} className={!area ? "on" : undefined}>
          All
        </Link>
        {AREAS.map((a) => (
          <Link key={a} href={href({ area: a })} className={area === a ? "on" : undefined}>
            {AREA_LABEL[a]}
          </Link>
        ))}
      </nav>

      <form method="get" className="history-filters">
        {area && <input type="hidden" name="area" value={area} />}
        <div>
          <label htmlFor="h-code">Code</label>
          <input id="h-code" name="code" defaultValue={sp.code ?? ""} placeholder="Batch, order, lot…" />
        </div>
        <div>
          <label htmlFor="h-action">What</label>
          <select id="h-action" name="action" defaultValue={sp.action ?? ""}>
            <option value="">Everything</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {k === "status" ? "Steps (confirm, close…)" : v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="h-from">From</label>
          <input id="h-from" name="from" type="date" defaultValue={sp.from ?? ""} />
        </div>
        <div>
          <label htmlFor="h-to">To</label>
          <input id="h-to" name="to" type="date" defaultValue={sp.to ?? ""} />
        </div>
        <button type="submit" className="secondary">
          Show
        </button>
        {filtered && (
          <Link href={area ? `/history?area=${area}` : "/history"} className="btn ghost">
            Clear
          </Link>
        )}
      </form>

      {page.length === 0 ? (
        <div className="card">
          <Empty title={filtered || area ? "No changes match" : "Nothing recorded yet"}>
            <p>Every time something is created, changed, deleted or restored, it shows here with when and why.</p>
          </Empty>
        </div>
      ) : (
        <div className="card">
          <ul className="changes">
            {page.map((c) => {
              const others = (links.get(c.id) ?? []).filter((l) => !(l.type === c.entityType && l.id === c.entityId) && l.code);
              return (
                <ChangeItem key={c.id} c={toRow(c)}>
                  {others.length > 0 && (
                    <p className="small muted" style={{ margin: "2px 0 0" }}>
                      Also on:{" "}
                      {others.slice(0, 6).map((l, i) => (
                        <span key={`${l.type}:${l.id}`}>
                          {i > 0 && ", "}
                          <Link href={openHref(l)}>{refLabel(l)}</Link>
                        </span>
                      ))}
                      {others.length > 6 && ` and ${others.length - 6} more`}
                    </p>
                  )}
                </ChangeItem>
              );
            })}
          </ul>
          {more && (
            <p style={{ marginTop: 12 }}>
              <Link href={href({ before: page[page.length - 1]!.at.toISOString(), beforeId: page[page.length - 1]!.id })} className="btn secondary">
                Show older
              </Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
