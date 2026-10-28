import { describe, expect, it } from "vitest";
import { clampInt, labelPages } from "../src/domain/label-sheet";

describe("label sheet layout", () => {
  it("fills one sheet from position 1", () => {
    const pages = labelPages(12, 1, 40);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.filter(Boolean)).toHaveLength(12);
  });

  it("leaves the used stickers blank and moves extra labels to a new sheet", () => {
    const pages = labelPages(30, 13, 40);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.slice(0, 12).every((c) => c === null)).toBe(true);
    expect(pages[0]!).toHaveLength(40);
    expect(pages[1]!).toHaveLength(2);
  });

  it("clamps typed numbers and falls back on empty text", () => {
    expect(clampInt("0", 1, 40, 1)).toBe(1);
    expect(clampInt("99", 1, 40, 1)).toBe(40);
    expect(clampInt("", 1, 40, 7)).toBe(7);
  });
});
