/**
 * Shelf life: how long a lot keeps from the day it was packed (jars) or
 * received (ingredients). Set once per product and per ingredient; the
 * best-before of each new lot is worked out from it and can still be changed
 * on that lot.
 */

export const SHELF_UNITS = {
  days: { one: "day", many: "days" },
  weeks: { one: "week", many: "weeks" },
  months: { one: "month", many: "months" },
} as const;

export type ShelfUnit = keyof typeof SHELF_UNITS;
export const SHELF_UNIT_KEYS = Object.keys(SHELF_UNITS) as ShelfUnit[];

export function isShelfUnit(v: unknown): v is ShelfUnit {
  return typeof v === "string" && v in SHELF_UNITS;
}

export interface ShelfLife {
  value: number;
  unit: ShelfUnit;
}

/** A shelf life from an item row, or null when it isn't set. */
export function shelfLifeOf(row: { shelfLife?: number | null; shelfLifeUnit?: string | null }): ShelfLife | null {
  if (!row.shelfLife || row.shelfLife <= 0 || !isShelfUnit(row.shelfLifeUnit)) return null;
  return { value: row.shelfLife, unit: row.shelfLifeUnit };
}

/** "12 months", "1 week", "Not set". */
export function shelfLifeLabel(s: ShelfLife | null): string {
  if (!s) return "Not set";
  const u = SHELF_UNITS[s.unit];
  return `${s.value} ${s.value === 1 ? u.one : u.many}`;
}

/** Read form values: an empty number clears it; otherwise a whole number from 1 to 3650 and a known unit. */
export function parseShelfLife(value: string | null | undefined, unit: string | null | undefined): ShelfLife | null | "invalid" {
  const v = (value ?? "").trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "invalid";
  const n = Number(v);
  if (n < 1 || n > 3650 || !isShelfUnit(unit)) return "invalid";
  return { value: n, unit };
}

/**
 * Best-before for a lot made on `fromIso` (YYYY-MM-DD). Months keep the day
 * of the month, or the last day when the month is shorter (31 Jan + 1 month
 * = 28 Feb). Returns null without a shelf life.
 */
export function bestBeforeFrom(fromIso: string, s: ShelfLife | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(fromIso)) return null;
  const [y, m, d] = fromIso.split("-").map(Number) as [number, number, number];
  let date: Date;
  if (s.unit === "months") {
    const total = m - 1 + s.value;
    const ty = y + Math.floor(total / 12);
    const tm = total % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(ty, tm, Math.min(d, last)));
  } else {
    date = new Date(Date.UTC(y, m - 1, d + s.value * (s.unit === "weeks" ? 7 : 1)));
  }
  return date.toISOString().slice(0, 10);
}

/** Whole days from `todayIso` to `isoDate` (negative when past). */
export function daysUntil(isoDate: string, todayIso: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 864e5);
}
