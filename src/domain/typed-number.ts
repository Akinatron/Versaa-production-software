/**
 * Numbers typed in forms. The number fields are plain text boxes (see
 * NumberInput), so "7,5" reaches the app as typed whatever language Windows
 * is in, and these are the only readers of what was typed: on the server
 * (readNumber in src/db/base.ts) and in the page (live totals).
 */

/**
 * The typed text as a number written with a point: "7,5" → "7.5", " 12 " → "12".
 * "" when empty; null when it isn't a number. One decimal mark only, so
 * "1.250,5" or "1,250.5" are refused rather than guessed.
 */
export function numberText(value: string): string | null {
  const raw = value.trim().replace(/\s+/g, "");
  if (raw === "") return "";
  const text = raw.includes(",") && !raw.includes(".") && raw.split(",").length === 2 ? raw.replace(",", ".") : raw;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? text : null;
}

/** A typed number: "7,5" → 7.5. NaN when empty or not a number. */
export function typedNumber(value: string | null | undefined): number {
  const text = numberText(value ?? "");
  return text ? Number(text) : NaN;
}

/**
 * A typed whole number (jars, packs, ml, days): "12" → 12, "12,0" → 12.
 * NaN when empty, not a number or not whole. "1.000" is NaN, not 1: a whole
 * number never has a thousands separator.
 */
export function wholeNumber(value: string | null | undefined): number {
  const v = (value ?? "").trim();
  if (!/^[+-]?\d+([.,]0*)?$/.test(v) || /^[+-]?\d+[.,]000$/.test(v)) return NaN;
  return Math.trunc(Number(v.replace(",", ".")));
}
