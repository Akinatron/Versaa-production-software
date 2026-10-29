import { deflateRawSync } from "node:zlib";

/*
 * A small Excel (.xlsx) writer for the report downloads: one sheet, a bold
 * header row that stays visible, filters, sensible column widths, and real
 * numbers and dates, so the file opens the same in any Excel, whatever the
 * computer's language (a CSV doesn't: Spanish Excel expects ; and decimal
 * commas). Text is never read as a formula.
 *
 * An .xlsx file is a zip of a few XML files; both are written here, with no
 * extra package.
 */

export type XlsxType = "text" | "number" | "date" | "datetime";
export type XlsxCell = string | number | null | undefined;

const NUMBER = /^-?\d+(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Days since 30 Dec 1899, the way Excel counts dates. */
function serial(y: number, m: number, d: number, h = 0, min = 0, s = 0) {
  return (Date.UTC(y, m - 1, d, h, min, s) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Characters XML 1.0 doesn't allow, and the XML specials escaped. */
function xmlText(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** "A", "B", … "Z", "AA", … */
export function columnName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Styles: 0 normal, 1 bold header, 2 date, 3 date and time.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, v: XlsxCell, type: XlsxType): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (type === "number" && (typeof v === "number" || NUMBER.test(s))) return `<c r="${ref}"><v>${Number(s)}</v></c>`;
  if (type === "date") {
    const m = DATE.exec(s);
    if (m) return `<c r="${ref}" s="2"><v>${serial(+m[1]!, +m[2]!, +m[3]!)}</v></c>`;
  }
  if (type === "datetime") {
    const m = DATETIME.exec(s);
    if (m) return `<c r="${ref}" s="3"><v>${serial(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0))}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`;
}

function sheetXml(header: string[], rows: XlsxCell[][], types: XlsxType[]): string {
  const width = (i: number) => {
    if (types[i] === "date") return 12;
    if (types[i] === "datetime") return 17;
    const longest = Math.max(header[i]!.length, ...rows.slice(0, 500).map((r) => String(r[i] ?? "").length));
    return Math.min(60, Math.max(8, longest + 2));
  };
  const cols = header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join("");
  const head = `<row r="1">${header.map((h, i) => `<c r="${columnName(i)}1" s="1" t="inlineStr"><is><t>${xmlText(h)}</t></is></c>`).join("")}</row>`;
  const body = rows
    .map((r, n) => `<row r="${n + 2}">${header.map((_, i) => cellXml(`${columnName(i)}${n + 2}`, r[i], types[i] ?? "text")).join("")}</row>`)
    .join("");
  const last = `${columnName(header.length - 1)}${rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

/** An .xlsx file with one sheet. `types` says how to write each column; text by default. */
export function toXlsx(sheetName: string, header: string[], rows: XlsxCell[][], types: XlsxType[] = []): Buffer {
  const name = xmlText(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replaceAll("'", "''")}'!$A$1:$${columnName(header.length - 1)}$${rows.length + 1}</definedName></definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(header, rows, types)],
  ];
  return zip(files.map(([path, text]) => ({ path, data: Buffer.from(text, "utf8") })));
}

// ---------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive (deflate), enough for Office files. */
export function zip(files: { path: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // A fixed date (1 Jan 2026) so the same content gives the same file.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // names in UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(dosTime, 10);
    head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + packed.length;
  }
  const dirSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
