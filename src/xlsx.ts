export const XLSX_STYLES = {
  normal: 0,
  title: 1,
  note: 2,
  section: 3,
  tableHeader: 4,
  total: 5,
  muted: 6,
  warning: 7,
} as const;

export type XlsxStyleId = (typeof XLSX_STYLES)[keyof typeof XLSX_STYLES];

export interface XlsxStyledCell {
  readonly value: string;
  readonly style?: XlsxStyleId;
}

export type XlsxCell = string | XlsxStyledCell;

export interface XlsxSheet {
  readonly name: string;
  readonly rows: readonly (readonly XlsxCell[])[];
  readonly columns?: readonly number[];
  readonly merges?: readonly string[];
}

interface ZipFile {
  readonly name: string;
  readonly content: Uint8Array;
}

const encoder = new TextEncoder();

export function buildXlsxBlob(sheets: readonly XlsxSheet[]): Blob {
  if (sheets.length === 0) throw new Error("XLSX exige ao menos uma aba.");

  const normalizedSheets = sheets.map((sheet, index) => ({
    name: sanitizeSheetName(sheet.name, index + 1),
    rows: sheet.rows,
    columns: sheet.columns,
    merges: (sheet.merges ?? []).flatMap((range) => {
      const sanitized = sanitizeMergeRange(range);
      return sanitized ? [sanitized] : [];
    }),
  }));

  const files: ZipFile[] = [
    xmlFile("[Content_Types].xml", contentTypesXml(normalizedSheets.length)),
    xmlFile("_rels/.rels", rootRelationshipsXml()),
    xmlFile("xl/workbook.xml", workbookXml(normalizedSheets.map((sheet) => sheet.name))),
    xmlFile("xl/_rels/workbook.xml.rels", workbookRelationshipsXml(normalizedSheets.length)),
    xmlFile("xl/styles.xml", stylesXml()),
    ...normalizedSheets.map((sheet, index) =>
      xmlFile(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)),
    ),
  ];

  const zip = zipStore(files);
  const buffer = new ArrayBuffer(zip.byteLength);
  new Uint8Array(buffer).set(zip);

  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function xmlFile(name: string, xml: string): ZipFile {
  return { name, content: encoder.encode(xml) };
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheetNames: readonly string[]): string {
  const sheets = sheetNames.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRelationshipsXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="8">
    <font><sz val="10"/><color rgb="FF001627"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF13496E"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF012A48"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF476D82"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFE582E"/><name val="Calibri"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF012A48"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF001627"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF13496E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFE582E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE6EEF3"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="FFE6EEF3"/></left>
      <right style="thin"><color rgb="FFE6EEF3"/></right>
      <top style="thin"><color rgb="FFE6EEF3"/></top>
      <bottom style="thin"><color rgb="FFE6EEF3"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function worksheetXml(sheet: Pick<XlsxSheet, "rows" | "columns" | "merges">): string {
  const rows = sheet.rows;
  const width = Math.max(1, sheet.columns?.length ?? 0, ...rows.map((row) => row.length));
  const cols = Array.from({ length: width }, (_, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(index, sheet.columns)}" customWidth="1"/>`,
  ).join("");
  const sheetRows = rows.map((row, rowIndex) => {
    const height = rowHeight(row);
    const cells = row.map((rawCell, colIndex) => {
      const cell = normalizeCell(rawCell);
      const style = cell.style !== undefined && cell.style !== XLSX_STYLES.normal
        ? ` s="${cell.style}"`
        : "";
      return `<c r="${columnName(colIndex + 1)}${rowIndex + 1}"${style} t="inlineStr"><is><t>${escapeXml(cell.value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
  }).join("");
  const mergeCells = mergeCellsXml(sheet.merges ?? []);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  ${mergeCells}
</worksheet>`;
}

function normalizeCell(cell: XlsxCell): XlsxStyledCell {
  return typeof cell === "string" ? { value: cell } : cell;
}

function columnWidth(index: number, customColumns: readonly number[] | undefined): number {
  const custom = customColumns?.[index];
  if (custom !== undefined) return custom;
  if (index === 0) return 30;
  if (index === 2) return 26;
  if (index === 3) return 34;
  return 20;
}

function rowHeight(row: readonly XlsxCell[]): string {
  const styles = row.map((cell) => normalizeCell(cell).style);
  if (styles.includes(XLSX_STYLES.title)) return ' ht="24" customHeight="1"';
  if (styles.includes(XLSX_STYLES.note)) return ' ht="40" customHeight="1"';
  return "";
}

function mergeCellsXml(merges: readonly string[]): string {
  if (merges.length === 0) return "";
  const cells = merges.map((range) => `<mergeCell ref="${range}"/>`).join("");
  return `<mergeCells count="${merges.length}">${cells}</mergeCells>`;
}

function sanitizeMergeRange(range: string): string | null {
  const cleaned = range.trim().toUpperCase();
  return /^[A-Z]{1,3}\d+:[A-Z]{1,3}\d+$/.test(cleaned) ? cleaned : null;
}

function columnName(index: number): string {
  let value = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    value = String.fromCharCode(65 + (current % 26)) + value;
    current = Math.floor(current / 26);
  }
  return value;
}

function sanitizeSheetName(name: string, fallbackIndex: number): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || `Aba ${fallbackIndex}`).slice(0, 31);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zipStore(files: readonly ZipFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.content);
    const localHeader = new Uint8Array(30 + name.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.content.length, true);
    local.setUint32(22, file.content.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, file.content);

    const centralHeader = new Uint8Array(46 + name.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, file.content.length, true);
    central.setUint32(24, file.content.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = makeCrcTable();

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}
