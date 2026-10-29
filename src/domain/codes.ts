/**
 * Short code for batch numbers. "Indiase Tikka Masala" → TIK,
 * "Italiaanse Bolognese" → BOL, "Liberiaanse Kip" → KIP: the first word is
 * where the sauce is from, so the second word names it.
 */
export function batchPrefixFor(sauceName: string): string {
  const words = sauceName
    .normalize("NFD")
    .replace(/[^A-Za-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const word = words[1] ?? words[0] ?? "BAT";
  return word.slice(0, 3).toUpperCase();
}

/** The size part of jar stock item and lot codes: the size's code without its "f" (250, 250-2). */
export function sizeTag(format: { code: string }) {
  return format.code.replace(/^f(?=\d)/, "");
}
