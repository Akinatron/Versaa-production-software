/**
 * Code 128 barcodes (code set B: letters, digits and the usual signs), drawn
 * as bar widths so a page can render them as SVG. Any USB scanner or phone
 * camera reads them; the app makes them itself, no internet needed.
 */

// Bar/space widths of each symbol 0–106 (106 is Stop, one bar longer).
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 " +
  "232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 " +
  "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const START_B = 104;
const STOP = 106;

/** True when every character can go in a Code 128 B barcode (printable ASCII). */
export function canEncode128(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

/** Symbol values: Start B, the characters, the check symbol, Stop. */
export function code128Values(text: string): number[] {
  if (!canEncode128(text)) throw new Error("Code 128 B only takes printable ASCII characters.");
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, check, STOP];
}

/** Alternating bar and space widths in modules, starting with a bar. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** Black bars as [x, width] in modules, plus the total width (quiet zones not included). */
export function code128Bars(text: string): { bars: [number, number][]; modules: number } {
  const bars: [number, number][] = [];
  let x = 0;
  code128Widths(text).forEach((w, i) => {
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  });
  return { bars, modules: x };
}
