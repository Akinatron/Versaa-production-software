import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { lotsByIds } from "@/db/trace";
import { canEncode128 } from "@/domain/barcode";
import { Barcode } from "../../../../components/barcode";
import { PrintButton } from "../../../../components/print-button";
import { fmtDate } from "../../../../components/ui/format";

export const dynamic = "force-dynamic";

/** Sheet formats. Apli 1285 / Avery 3651 style: 40 labels of 52.5 × 29.7 mm on A4, no margins. */
const SHEETS = {
  a4_40: { name: "A4, 40 labels (52.5 × 29.7 mm)", cols: 4, rows: 10, w: 52.5, h: 29.7 },
} as const;
type SheetKey = keyof typeof SHEETS;

const clampInt = (v: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function Label({ name, code, bestBefore }: { name: string; code: string; bestBefore: string | null }) {
  return (
    <div className="jar-label">
      <div className="jl-name">{name}</div>
      <div className="jl-line">Lot {code}</div>
      <div className="jl-line">Best before {bestBefore ? fmtDate(bestBefore, { year: true }) : "—"}</div>
      <Barcode value={code} className="jl-bars" />
    </div>
  );
}

export default async function JarLabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const [lot] = await lotsByIds(db(), [id]);
  if (!lot) notFound();
  if (lot.itemKind !== "finished") {
    return (
      <div className="card">
        Labels are made for lots of filled jars. <Link href={`/trace/lot/${lot.id}`}>Back to the lot</Link>
      </div>
    );
  }
  const sheetKey: SheetKey = "a4_40";
  const sheet = SHEETS[sheetKey];
  const perSheet = sheet.cols * sheet.rows;
  const inStock = Math.max(0, Math.floor(lot.balance.toNumber()));
  const count = clampInt(q.count, 1, 2000, Math.max(1, inStock));
  const start = clampInt(q.start, 1, perSheet, 1);
  const single = q.single === "1";
  const back = `/trace/lot/${lot.id}`;
  const label = <Label name={lot.itemName} code={lot.code} bestBefore={lot.bestBefore} />;

  // Empty cells first (a sheet already partly used), then the labels, split into A4 pages.
  const cells: (boolean | null)[] = [...Array(start - 1).fill(null), ...Array(count).fill(true)];
  const pages: (boolean | null)[][] = [];
  for (let i = 0; i < cells.length; i += perSheet) pages.push(cells.slice(i, i + perSheet));

  const pageCss = single ? `@page { size: ${sheet.w}mm ${sheet.h}mm; margin: 0; }` : `@page { size: A4; margin: 0; }`;
  const vars = { "--jl-w": `${sheet.w}mm`, "--jl-h": `${sheet.h}mm`, "--jl-cols": sheet.cols } as React.CSSProperties;

  return (
    <div className="labels-page" style={vars}>
      <style>{pageCss}</style>
      <div className="no-print">
        <Link href={back} className="back">
          Lot {lot.code}
        </Link>
        <h1 style={{ margin: "6px 0 4px" }}>{single ? "One label" : "Jar labels"}</h1>
        <p className="small muted" style={{ marginTop: 0 }}>
          {lot.itemName} · {inStock} {inStock === 1 ? "jar" : "jars"} in stock in this lot. Every jar of the lot gets the same label.
        </p>
        {!canEncode128(lot.code) && <p className="card small">This lot code has characters a barcode can&apos;t hold, so the labels show the text only.</p>}
        {single ? (
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            <PrintButton label="Print or save as PDF" />
            <Link href={`${back}/labels`} className="btn secondary">
              Back to the full sheet
            </Link>
          </div>
        ) : (
          <form className="card row" style={{ alignItems: "flex-end", marginBottom: 16 }}>
            <div>
              <label htmlFor="count">Labels</label>
              <input id="count" name="count" type="number" min={1} max={2000} defaultValue={count} style={{ width: 100 }} />
            </div>
            <div>
              <label htmlFor="start">Start at position</label>
              <input id="start" name="start" type="number" min={1} max={perSheet} defaultValue={start} style={{ width: 100 }} />
            </div>
            <div>
              <label>Sheet</label>
              <div className="small" style={{ padding: "8px 0" }}>
                {sheet.name}
              </div>
            </div>
            <button type="submit" className="secondary">
              Update
            </button>
            <PrintButton label="Print or save as PDF" />
            <Link href={`${back}/labels?single=1`} className="btn secondary">
              Download one label
            </Link>
            <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
              {pages.length} {pages.length === 1 ? "sheet" : "sheets"}. Print at 100% scale with no margins so the labels line up with the sheet. Use
              &quot;Start at position&quot; to finish a sheet that is already partly used (positions count left to right, top to bottom).
            </p>
          </form>
        )}
      </div>
      {single ? (
        <div className="label-single">{label}</div>
      ) : (
        pages.map((p, i) => (
          <div className="label-sheet" key={i}>
            {p.map((c, j) => (
              <div className="label-cell" key={j}>
                {c ? label : null}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
