import type { RevenueSegmentCode } from "./calc";
import { parseMoneyToCents } from "./money";

export interface ImportedActivity {
  readonly description: string;
  readonly annex: "I";
  readonly segments: Partial<Record<RevenueSegmentCode, string>>;
}

export interface DasPdfImportData {
  readonly source: "pgdas-d-extrato";
  readonly companyName?: string;
  readonly cnpj?: string;
  readonly openingDate?: string;
  readonly period?: string;
  readonly rpaInternal?: string;
  readonly rpaExternal?: string;
  readonly rbt12Internal?: string;
  readonly rbt12External?: string;
  readonly currentYearRevenueInternal?: string;
  readonly currentYearRevenueExternal?: string;
  readonly currentYearBeforeInternal?: string;
  readonly currentYearBeforeExternal?: string;
  readonly priorInternal?: string;
  readonly priorExternal?: string;
  readonly impeded?: boolean;
  readonly monthlyInternal: Readonly<Record<string, string>>;
  readonly monthlyExternal: Readonly<Record<string, string>>;
  readonly monthlyPayroll: Readonly<Record<string, string>>;
  readonly activities: readonly ImportedActivity[];
  readonly warnings: readonly string[];
  readonly recognizedFields: readonly string[];
}

type PdfInflater = (bytes: Uint8Array) => Promise<Uint8Array>;

const MONEY_RE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/;
const PERIOD_RE = /^(\d{2})\/(\d{4})$/;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export async function extractDasPdf(
  buffer: ArrayBuffer,
  inflater: PdfInflater = inflatePdfStream,
): Promise<DasPdfImportData> {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("O PDF e maior que 8 MB. Use um Extrato DAS textual menor.");
  }

  const lines = await extractPdfTextLines(buffer, inflater);
  if (!lines.some((line) => /Extrato do Simples Nacional|PGDAS-D/i.test(line))) {
    throw new Error("Nao reconheci este arquivo como Extrato do Simples Nacional/PGDAS-D.");
  }
  return parseDasTextLines(lines);
}

export async function extractPdfTextLines(
  buffer: ArrayBuffer,
  inflater: PdfInflater = inflatePdfStream,
): Promise<string[]> {
  const binary = new TextDecoder("latin1").decode(buffer);
  const streams = findPdfStreams(binary);
  const lines: string[] = [];

  for (const stream of streams) {
    try {
      let bytes = stream.bytes;
      if (stream.flate) {
        bytes = await inflater(bytes);
      }
      lines.push(...extractTextStrings(bytes));
    } catch (error) {
      if (isUnsupportedInflaterError(error)) throw error;
    }
  }

  return lines
    .map(normalizePdfLine)
    .filter((line) => line !== "" && line !== ".");
}

export function parseDasTextLines(rawLines: readonly string[]): DasPdfImportData {
  const lines = rawLines.map(normalizePdfLine).filter(Boolean);
  const recognized = new Set<string>();
  const warnings: string[] = [];
  const companyName = matchGroup(lines, /Nome Empresarial:\s*(.+)$/i);
  const cnpj = matchGroup(lines, /CNPJ Estabelecimento:\s*([\d./-]+)/i);
  const openingDate = brDateToIso(matchGroup(lines, /Data de Abertura:\s*(\d{2}\/\d{2}\/\d{4})/i));
  const period = brPeriodToIso(matchGroup(lines, /Per[ií]odo de Apura[cç][aã]o.*?:\s*(\d{2}\/\d{4})/i));
  const rpa = moneyTripletAfter(lines, (line) => /Receita Bruta do PA/i.test(line));
  const rbt12 = moneyTripletAfter(lines, (_line, index) =>
    /Receita bruta acumulada nos doze meses anteriores ao PA/i.test(lines[index])
      && /\(?RBT12\)?/i.test(lines[index + 1] ?? "")
      && !/proporcionalizada/i.test(lines[index + 1] ?? ""),
  );
  const rba = moneyTripletAfter(lines, (line) => /Receita bruta acumulada no ano-calend[aá]rio corrente/i.test(line));
  const rbaa = moneyTripletAfter(lines, (line) => /Receita bruta acumulada no ano-calend[aá]rio anterior/i.test(line));
  const impededText = matchGroup(lines, /Impedido de recolher ICMS\/ISS no DAS:\s*(Sim|N[aã]o)/i);
  const monthlyInternal = monthlyPairsBetween(lines, /2\.2\.1/i, /2\.2\.2/i);
  const monthlyExternal = monthlyPairsBetween(lines, /2\.2\.2/i, /2\.3/i);
  const monthlyPayroll = monthlyPairsBetween(lines, /2\.3/i, /2\.4/i);
  const activities = parseActivities(lines);

  if (companyName) recognized.add("empresa");
  if (cnpj) recognized.add("cnpj");
  if (openingDate) recognized.add("abertura");
  if (period) recognized.add("competencia");
  if (rpa) recognized.add("receita do PA");
  if (rbt12) recognized.add("RBT12");
  if (rba) recognized.add("RBA do ano");
  if (rbaa) recognized.add("RBAA");
  if (impededText) recognized.add("impedimento ICMS/ISS");
  if (Object.keys(monthlyInternal).length > 0 || Object.keys(monthlyExternal).length > 0) {
    recognized.add("receitas mensais anteriores");
  }
  if (Object.keys(monthlyPayroll).length > 0) recognized.add("folha mensal");
  if (activities.length > 0) recognized.add("atividades de revenda");

  const currentYearBeforeInternal = subtractMoney(rba?.internal, rpa?.internal);
  const currentYearBeforeExternal = subtractMoney(rba?.external, rpa?.external);
  if (!rbt12 && Object.keys(monthlyInternal).length === 0) {
    warnings.push("Nao encontrei RBT12 nem receitas mensais anteriores no PDF.");
  }
  if (activities.length === 0) {
    warnings.push("Nao preenchi atividades automaticamente; confira a segregacao da receita manualmente.");
  } else {
    warnings.push("Atividades importadas por inferencia textual; revise Anexo e segregacoes antes de usar.");
  }

  return {
    source: "pgdas-d-extrato",
    companyName,
    cnpj,
    openingDate,
    period,
    rpaInternal: rpa?.internal,
    rpaExternal: rpa?.external,
    rbt12Internal: rbt12?.internal,
    rbt12External: rbt12?.external,
    currentYearRevenueInternal: rba?.internal,
    currentYearRevenueExternal: rba?.external,
    currentYearBeforeInternal,
    currentYearBeforeExternal,
    priorInternal: rbaa?.internal,
    priorExternal: rbaa?.external,
    impeded: impededText ? /^sim$/i.test(impededText) : undefined,
    monthlyInternal,
    monthlyExternal,
    monthlyPayroll,
    activities,
    warnings,
    recognizedFields: [...recognized],
  };
}

function findPdfStreams(binary: string): { bytes: Uint8Array; flate: boolean }[] {
  const streams: { bytes: Uint8Array; flate: boolean }[] = [];
  let cursor = 0;
  while (cursor < binary.length) {
    const streamIndex = binary.indexOf("stream", cursor);
    if (streamIndex < 0) break;
    let contentStart = streamIndex + "stream".length;
    if (binary.slice(contentStart, contentStart + 2) === "\r\n") contentStart += 2;
    else if (binary[contentStart] === "\n" || binary[contentStart] === "\r") contentStart += 1;

    const dictionaryStart = binary.lastIndexOf("<<", streamIndex);
    const dictionary = dictionaryStart >= 0 ? binary.slice(dictionaryStart, streamIndex) : "";
    const declaredLength = pdfStreamLength(dictionary);
    const fallbackEndIndex = binary.indexOf("endstream", contentStart);
    const contentEnd = declaredLength !== null
      ? Math.min(contentStart + declaredLength, binary.length)
      : trimPdfStreamEnd(binary, fallbackEndIndex);

    if (contentEnd < contentStart) break;
    streams.push({
      bytes: bytesFromBinary(binary.slice(contentStart, contentEnd)),
      flate: /\/FlateDecode\b/.test(dictionary),
    });
    const endIndex = binary.indexOf("endstream", contentEnd);
    cursor = (endIndex >= 0 ? endIndex : contentEnd) + "endstream".length;
  }
  return streams;
}

function pdfStreamLength(dictionary: string): number | null {
  const match = dictionary.match(/\/Length\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

function trimPdfStreamEnd(binary: string, endIndex: number): number {
  if (endIndex < 0) return -1;
  if (binary.slice(endIndex - 2, endIndex) === "\r\n") return endIndex - 2;
  if (binary[endIndex - 1] === "\n" || binary[endIndex - 1] === "\r") return endIndex - 1;
  return endIndex;
}

function bytesFromBinary(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

async function inflatePdfStream(bytes: Uint8Array): Promise<Uint8Array> {
  const streamConstructor = globalThis.DecompressionStream;
  if (!streamConstructor) {
    throw new Error("Este navegador nao suporta descompactar PDF localmente. Atualize o navegador ou preencha manualmente.");
  }

  try {
    return await decompress(bytes, "deflate");
  } catch {
    return decompress(bytes, "deflate-raw");
  }
}

async function decompress(bytes: Uint8Array, format: string): Promise<Uint8Array> {
  const ds = new DecompressionStream(format as CompressionFormat);
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const output = await new Response(new Blob([input]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(output);
}

function isUnsupportedInflaterError(error: unknown): boolean {
  return error instanceof Error && /nao suporta descompactar PDF/i.test(error.message);
}

function extractTextStrings(bytes: Uint8Array): string[] {
  const content = new TextDecoder("windows-1252").decode(bytes);
  const strings: string[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "(") continue;
    const result = readLiteralString(content, index + 1);
    if (!result) continue;
    strings.push(result.value);
    index = result.endIndex;
  }
  return strings;
}

function readLiteralString(content: string, startIndex: number): { value: string; endIndex: number } | null {
  let depth = 1;
  let output = "";
  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\\") {
      const escaped = readEscapedChar(content, index + 1);
      output += escaped.value;
      index = escaped.endIndex;
      continue;
    }
    if (char === "(") {
      depth += 1;
      output += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { value: output, endIndex: index };
      output += char;
      continue;
    }
    output += char;
  }
  return null;
}

function readEscapedChar(content: string, index: number): { value: string; endIndex: number } {
  const char = content[index] ?? "";
  if (char === "n") return { value: "\n", endIndex: index };
  if (char === "r") return { value: "\r", endIndex: index };
  if (char === "t") return { value: "\t", endIndex: index };
  if (char === "b") return { value: "\b", endIndex: index };
  if (char === "f") return { value: "\f", endIndex: index };
  if (char === "\r" && content[index + 1] === "\n") return { value: "", endIndex: index + 1 };
  if (char === "\n" || char === "\r") return { value: "", endIndex: index };
  if (/[0-7]/.test(char)) {
    let octal = char;
    let endIndex = index;
    for (let count = 0; count < 2 && /[0-7]/.test(content[endIndex + 1] ?? ""); count += 1) {
      endIndex += 1;
      octal += content[endIndex];
    }
    return { value: String.fromCharCode(parseInt(octal, 8)), endIndex };
  }
  return { value: char, endIndex: index };
}

function normalizePdfLine(line: string): string {
  return line
    .replace(/\\([()])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function matchGroup(lines: readonly string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function moneyTripletAfter(
  lines: readonly string[],
  predicate: (line: string, index: number) => boolean,
): { internal: string; external: string; total: string } | undefined {
  const index = lines.findIndex(predicate);
  if (index < 0) return undefined;
  const values = nextMoneyValues(lines, index + 1, 3);
  if (values.length < 3) return undefined;
  return { internal: values[0], external: values[1], total: values[2] };
}

function nextMoneyValues(lines: readonly string[], start: number, count: number): string[] {
  const values: string[] = [];
  for (let index = start; index < lines.length && values.length < count; index += 1) {
    if (isMoney(lines[index])) values.push(cleanMoney(lines[index]));
  }
  return values;
}

function monthlyPairsBetween(lines: readonly string[], startPattern: RegExp, endPattern: RegExp): Record<string, string> {
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start < 0) return {};
  const endOffset = lines.slice(start + 1).findIndex((line) => endPattern.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return parseMonthlyPairs(lines.slice(start + 1, end));
}

function parseMonthlyPairs(lines: readonly string[]): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (let index = 0; index < lines.length - 1; index += 1) {
    const period = brPeriodToIso(lines[index]);
    if (!period) continue;
    const money = lines.slice(index + 1).find(isMoney);
    if (money) pairs[period] = cleanMoney(money);
  }
  return pairs;
}

function parseActivities(lines: readonly string[]): ImportedActivity[] {
  const segments: Partial<Record<RevenueSegmentCode, string>> = {};
  let foundCommerce = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/Receita Bruta Informada:\s*R\$/i.test(line)) continue;
    const revenue = cleanMoney(line.replace(/^.*R\$\s*/i, ""));
    const context = lines.slice(Math.max(0, index - 5), index + 8).join(" ");
    if (/Revenda de mercadorias/i.test(context)) foundCommerce = true;

    const remaining = lines.slice(index + 1, index + 12);
    const boundary = remaining.findIndex((item) =>
      /Receita Bruta Informada:\s*R\$|Valor do D[eé]bito por Tributo para a Atividade/i.test(item),
    );
    const activityLines = boundary >= 0 ? remaining.slice(0, boundary) : remaining;
    const parcels = parseParcels(activityLines);
    if (parcels.length > 0) {
      for (const parcel of parcels) addSegment(segments, parcel.segment, parcel.value);
    } else if (/Sem substitui[cç][aã]o tribut[aá]ria\/tributa[cç][aã]o monof[aá]sica/i.test(context)) {
      addSegment(segments, "icms_normal_pis_cofins_normal", revenue);
    }
  }

  if (!foundCommerce || Object.keys(segments).length === 0) return [];
  return [{
    description: "Revenda de mercadorias importada do Extrato DAS",
    annex: "I",
    segments,
  }];
}

function parseParcels(lines: readonly string[]): { value: string; segment: RevenueSegmentCode }[] {
  const parcels: { value: string; segment: RevenueSegmentCode }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/Parcela\s+\d+:\s*R\$\s*([\d.,]+)/i);
    if (!match) continue;
    const notes = lines.slice(index + 1, index + 4).join(" ");
    const hasSt = /Substitui[cç][aã]o tribut[aá]ria de:\s*ICMS/i.test(notes);
    const hasMono = /Tributa[cç][aã]o monof[aá]sica de:\s*(?:COFINS,\s*)?PIS|Tributa[cç][aã]o monof[aá]sica de:\s*COFINS,\s*PIS/i.test(notes);
    if (hasSt && hasMono) parcels.push({ value: cleanMoney(match[1]), segment: "icms_st_pis_cofins_monofasico" });
    else if (hasSt) parcels.push({ value: cleanMoney(match[1]), segment: "icms_st_pis_cofins_normal" });
    else if (hasMono) parcels.push({ value: cleanMoney(match[1]), segment: "icms_normal_pis_cofins_monofasico" });
  }
  return parcels;
}

function addSegment(
  segments: Partial<Record<RevenueSegmentCode, string>>,
  code: RevenueSegmentCode,
  value: string,
): void {
  const current = parseMoneyToCents(segments[code] ?? "") ?? 0;
  const incoming = parseMoneyToCents(value) ?? 0;
  segments[code] = centsToInput(current + incoming);
}

function isMoney(value: string): boolean {
  return MONEY_RE.test(value.trim());
}

function cleanMoney(value: string): string {
  const match = value.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
  return match ? match[1] : value.trim();
}

function brDateToIso(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function brPeriodToIso(value: string | undefined): string | undefined {
  const match = value?.match(PERIOD_RE);
  return match ? `${match[2]}-${match[1]}` : undefined;
}

function subtractMoney(total: string | undefined, current: string | undefined): string | undefined {
  if (!total || !current) return undefined;
  const totalCents = parseMoneyToCents(total);
  const currentCents = parseMoneyToCents(current);
  if (totalCents === null || currentCents === null || totalCents < currentCents) return undefined;
  return centsToInput(totalCents - currentCents);
}

function centsToInput(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
