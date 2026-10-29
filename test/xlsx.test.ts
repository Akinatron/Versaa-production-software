import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { columnName, toXlsx, zip } from "@/lib/xlsx";

/* The Excel downloads: a valid zip of the expected parts, real numbers and dates, text never a formula. */

/** Read every file of a zip made by `zip()`. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    i += 30 + nameLen + extra + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  return out;
}

describe("xlsx", () => {
  it("names columns like Excel", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("zips files that can be read back", () => {
    const files = unzip(
      zip([
        { path: "a.txt", data: Buffer.from("héllo") },
        { path: "dir/b.xml", data: Buffer.from("<x/>".repeat(100)) },
      ]),
    );
    expect(files.get("a.txt")).toBe("héllo");
    expect(files.get("dir/b.xml")).toBe("<x/>".repeat(100));
  });

  it("writes numbers as numbers, dates as dates and text safely", () => {
    const file = toXlsx(
      "movements",
      ["date", "item", "quantity", "recorded at", "reason"],
      [
        ["2026-10-24", "Cebolla roja", "-12.5", "2026-10-24 18:05", "Rotura, 2 sacos"],
        ["2026-10-25", '=HYPERLINK("x")', "1250", null, "<b> & \u0001"],
      ],
      ["date", "text", "number", "datetime", "text"],
    );
    const parts = unzip(file);
    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = parts.get("xl/worksheets/sheet1.xml")!;
    // 24 Oct 2026 is day 46319 for Excel; 18:05 is 0.7534…
    expect(sheet).toContain('<c r="A2" s="2"><v>46319</v></c>');
    expect(sheet).toContain('<c r="C2"><v>-12.5</v></c>');
    expect(sheet).toContain('<c r="C3"><v>1250</v></c>');
    expect(sheet).toMatch(/<c r="D2" s="3"><v>46319\.753472\d*<\/v><\/c>/);
    expect(sheet).toContain("Rotura, 2 sacos");
    // A formula-looking text stays text, special characters are escaped, invalid ones dropped.
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t></is></c>');
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("&lt;b&gt; &amp; </t>");
    // Empty cells are left out; the header is bold and stays visible; filters on the whole table.
    expect(sheet).not.toContain('r="D3"');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>date</t></is></c>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>');
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="movements"');
  });
});
