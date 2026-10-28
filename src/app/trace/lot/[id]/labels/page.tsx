import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { lotsByIds } from "@/db/trace";
import { canEncode128 } from "@/domain/barcode";
import { clampInt } from "@/domain/label-sheet";
import { JarLabel, LabelSheets } from "../../../../components/label-sheets";
import { PrintButton } from "../../../../components/print-button";
import { fmtDate } from "../../../../components/ui/format";

export const dynamic = "force-dynamic";

/** Sheet formats. Apli 1285 / Avery 3651 style: 40 labels of 52.5 × 29.7 mm on A4, no margins. */
const SHEETS = {
  a4_40: { name: "A4, 40 labels (52.5 × 29.7 mm)", cols: 4, rows: 10, w: 52.5, h: 29.7 },
} as const;
type SheetKey = keyof typeof SHEETS;

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
  const bestBefore = lot.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : "—";

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
        ) : null}
      </div>
      {single ? (
        <div className="label-single">
          <JarLabel name={lot.itemName} code={lot.code} bestBefore={bestBefore} />
        </div>
      ) : (
        <LabelSheets
          name={lot.itemName}
          code={lot.code}
          bestBefore={bestBefore}
          sheet={sheet}
          initialCount={count}
          initialStart={start}
          singleHref={`${back}/labels?single=1`}
        />
      )}
    </div>
  );
}
