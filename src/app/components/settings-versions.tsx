import Link from "next/link";
import { fmtDate as fmtDay } from "./ui/format";

/** Shared bits for the Settings sub-pages (recipes and packaging lists are versioned the same way). */

export const VERSION_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft (not used yet)", cls: "warn" },
  active: { label: "Active", cls: "ok" },
  retired: { label: "Retired", cls: "neutral" },
};

export const fmtDate = (d: Date | null | undefined) => (d ? fmtDay(d.toISOString().slice(0, 10), { year: true }) : "—");

export interface VersionRow {
  id: string;
  versionNo: number;
  status: string;
  createdAt: Date;
  activatedAt: Date | null;
  lines: number;
  used: number;
  note?: string | null;
}

/** All versions, newest first, each viewable. `usedLabel` says what "used" counts (batches, packaging sessions). */
export function VersionHistory({
  versions,
  viewHref,
  usedLabel,
  current,
}: {
  versions: VersionRow[];
  viewHref: (id: string) => string;
  usedLabel: string;
  current?: string;
}) {
  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Created</th>
            <th>Activated</th>
            <th className="num">Lines</th>
            <th className="num">{usedLabel}</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const st = VERSION_STATUS[v.status] ?? { label: v.status, cls: "" };
            return (
              <tr key={v.id} style={v.id === current ? { background: "var(--bg)" } : undefined}>
                <td>v{v.versionNo}</td>
                <td>
                  <span className={`badge ${st.cls}`} style={{ whiteSpace: "nowrap" }}>
                    {st.label}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(v.createdAt)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(v.activatedAt)}</td>
                <td className="num">{v.lines}</td>
                <td className="num">{v.used}</td>
                <td className="small" style={{ minWidth: 200 }}>
                  {v.note ?? <span className="muted">—</span>}
                </td>
                <td>{v.id === current ? <span className="small muted">showing</span> : <Link href={viewHref(v.id)}>View</Link>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Invisible first submit button, so pressing Enter in a field saves instead of hitting a row's Remove button. */
export function DefaultSubmit({ name, value }: { name: string; value: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      tabIndex={-1}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: -9999,
        width: 1,
        height: 1,
        overflow: "hidden",
      }}
    >
      Save
    </button>
  );
}
