/** Colours a sauce can have. The key is stored on the sauce; the CSS lives in globals.css (.sc-<key>). */
export const SAUCE_COLORS = [
  { key: "saffron", label: "Saffron" },
  { key: "tomato", label: "Tomato" },
  { key: "olive", label: "Olive" },
  { key: "teal", label: "Teal" },
  { key: "plum", label: "Plum" },
  { key: "blue", label: "Blue" },
  { key: "rose", label: "Rose" },
  { key: "clay", label: "Clay" },
  { key: "slate", label: "Grey" },
] as const;

export type SauceColor = (typeof SAUCE_COLORS)[number]["key"];

export const isSauceColor = (v: string): v is SauceColor => SAUCE_COLORS.some((c) => c.key === v);

/** First colour no other sauce uses yet, so a new sauce stands out. */
export function nextSauceColor(used: string[]): SauceColor {
  return SAUCE_COLORS.find((c) => c.key !== "slate" && !used.includes(c.key))?.key ?? "slate";
}
