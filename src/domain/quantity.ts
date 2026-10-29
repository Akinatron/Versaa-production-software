import Decimal from "decimal.js";

/**
 * Units are grouped by dimension. Conversion only happens inside a dimension:
 * kilograms are never turned into litres, and jars are never turned into either.
 */
export type Dimension = "mass" | "volume" | "count";
export type UnitCode = "g" | "kg" | "ml" | "L" | "unit";

interface UnitDef {
  dimension: Dimension;
  /** How many base units (g, ml, unit) one of this unit is. */
  factor: Decimal;
  label: string;
}

export const UNITS: Record<UnitCode, UnitDef> = {
  g: { dimension: "mass", factor: new Decimal(1), label: "g" },
  kg: { dimension: "mass", factor: new Decimal(1000), label: "kg" },
  ml: { dimension: "volume", factor: new Decimal(1), label: "ml" },
  L: { dimension: "volume", factor: new Decimal(1000), label: "L" },
  unit: { dimension: "count", factor: new Decimal(1), label: "units" },
};

export function isUnitCode(value: string): value is UnitCode {
  return value in UNITS;
}

/** The unit as people read it ("units", not "unit"), for messages. */
export const unitWord = (unit: string) => (isUnitCode(unit) ? UNITS[unit].label : unit);

export function dimensionOf(unit: UnitCode): Dimension {
  return UNITS[unit].dimension;
}

export class UnitMismatchError extends Error {
  constructor(from: UnitCode, to: UnitCode) {
    super(`Cannot convert ${from} to ${to}: they measure different things.`);
    this.name = "UnitMismatchError";
  }
}

/** Convert a value between units of the same dimension. Exact decimal maths. */
export function convert(value: Decimal.Value, from: UnitCode, to: UnitCode): Decimal {
  const f = UNITS[from];
  const t = UNITS[to];
  if (f.dimension !== t.dimension) throw new UnitMismatchError(from, to);
  return new Decimal(value).mul(f.factor).div(t.factor);
}

/** Format a quantity for display, trimming trailing zeros (max 3 decimals). */
/** Litres in so many jars of a size: jars × fill per jar (ml) ÷ 1000. The SQL twin is sumLitres() in src/db/base.ts. */
export const litresFromJars = (jars: Decimal.Value, fillMl: Decimal.Value) => new Decimal(jars).mul(fillMl).div(1000);

export function formatQty(value: Decimal | null, unit: UnitCode): string {
  if (value === null) return `unknown ${UNITS[unit].label}`;
  const dp = unit === "unit" ? 0 : 3;
  return `${value.toDecimalPlaces(dp).toString()} ${UNITS[unit].label}`;
}

export { Decimal };
