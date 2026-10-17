/** CSV writing: RFC 4180 quoting, plus protection against spreadsheet formulas in text cells. */

export type Cell = string | number | null | undefined;

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // A text cell starting with = + - @ would be run as a formula by Excel; numbers are left alone.
  if (typeof v === "string" && !NUMERIC.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  // The BOM makes Excel read accents (é, ë) correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
