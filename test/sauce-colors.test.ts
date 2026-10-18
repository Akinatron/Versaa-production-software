import { describe, expect, it } from "vitest";
import { isSauceColor, nextSauceColor } from "@/domain/sauce-colors";

describe("sauce colours", () => {
  it("gives a new sauce the first colour nobody uses", () => {
    expect(nextSauceColor([])).toBe("saffron");
    expect(nextSauceColor(["saffron", "tomato"])).toBe("olive");
  });
  it("falls back to grey when every colour is taken", () => {
    expect(nextSauceColor(["saffron", "tomato", "olive", "teal", "plum", "blue", "rose", "clay"])).toBe("slate");
  });
  it("only accepts listed colours", () => {
    expect(isSauceColor("teal")).toBe(true);
    expect(isSauceColor("red; background:url(x)")).toBe(false);
  });
});
