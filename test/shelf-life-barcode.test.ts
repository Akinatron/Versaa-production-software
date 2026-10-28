import { describe, expect, it } from "vitest";
import { bestBeforeFrom, daysUntil, parseShelfLife, shelfLifeLabel, shelfLifeOf } from "@/domain/shelf-life";
import { canEncode128, code128Bars, code128Values, code128Widths } from "@/domain/barcode";

describe("shelf life", () => {
  it("adds months, keeping the day or using the month's last day", () => {
    expect(bestBeforeFrom("2026-10-28", { value: 12, unit: "months" })).toBe("2027-10-28");
    expect(bestBeforeFrom("2026-01-31", { value: 1, unit: "months" })).toBe("2026-02-28");
    expect(bestBeforeFrom("2027-12-15", { value: 3, unit: "months" })).toBe("2028-03-15");
  });
  it("adds days and weeks", () => {
    expect(bestBeforeFrom("2026-12-28", { value: 7, unit: "days" })).toBe("2027-01-04");
    expect(bestBeforeFrom("2026-10-28", { value: 2, unit: "weeks" })).toBe("2026-11-11");
  });
  it("gives no date without a shelf life", () => {
    expect(bestBeforeFrom("2026-10-28", null)).toBeNull();
    expect(shelfLifeOf({ shelfLife: null, shelfLifeUnit: null })).toBeNull();
    expect(shelfLifeOf({ shelfLife: 6, shelfLifeUnit: "months" })).toEqual({ value: 6, unit: "months" });
  });
  it("reads form input", () => {
    expect(parseShelfLife("", "months")).toBeNull();
    expect(parseShelfLife("12", "months")).toEqual({ value: 12, unit: "months" });
    expect(parseShelfLife("1.5", "months")).toBe("invalid");
    expect(parseShelfLife("0", "days")).toBe("invalid");
    expect(parseShelfLife("5", "years")).toBe("invalid");
  });
  it("labels and counts days", () => {
    expect(shelfLifeLabel({ value: 12, unit: "months" })).toBe("12 months");
    expect(shelfLifeLabel({ value: 1, unit: "weeks" })).toBe("1 week");
    expect(daysUntil("2026-11-27", "2026-10-28")).toBe(30);
    expect(daysUntil("2026-10-20", "2026-10-28")).toBe(-8);
  });
});

describe("Code 128 barcode", () => {
  it("adds start, check and stop symbols", () => {
    // "PJJ123C" with Start B: (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 55.
    const v = code128Values("PJJ123C");
    expect(v[0]).toBe(104);
    expect(v.at(-2)).toBe(55);
    expect(v.at(-1)).toBe(106);
  });
  it("draws 11 modules per symbol and 13 for stop", () => {
    const code = "TIK-20261028-01-250";
    const widths = code128Widths(code);
    expect(widths.reduce((a, b) => a + b, 0)).toBe((code.length + 2) * 11 + 13);
    expect(code128Bars(code).modules).toBe((code.length + 2) * 11 + 13);
  });
  it("only takes printable ASCII", () => {
    expect(canEncode128("TIK-20261028-01-250")).toBe(true);
    expect(canEncode128("Ñ")).toBe(false);
    expect(canEncode128("")).toBe(false);
  });
});
