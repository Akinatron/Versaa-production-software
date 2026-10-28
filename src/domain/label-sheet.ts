/** Splits labels into A4 pages. Cells before `start` stay empty (a sheet already partly used). `true` = a label, `null` = an empty cell. */
export function labelPages(count: number, start: number, perSheet: number): (true | null)[][] {
  const cells: (true | null)[] = [...Array<null>(Math.max(0, start - 1)).fill(null), ...Array<true>(Math.max(0, count)).fill(true)];
  const pages: (true | null)[][] = [];
  for (let i = 0; i < cells.length; i += perSheet) pages.push(cells.slice(i, i + perSheet));
  return pages;
}

/** Reads a whole number from text and keeps it between min and max. Empty or invalid text gives the fallback. */
export function clampInt(v: string | undefined | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
