import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";

import { extractPdfTextLines, parseDasTextLines } from "../src/das-pdf";

describe("parseDasTextLines", () => {
  it("extrai bases, historico mensal e atividade de revenda do Extrato DAS", () => {
    const data = parseDasTextLines([
      "Extrato do Simples Nacional",
      "Nome Empresarial: A & C EVENTOS E PROMOCOES LTDA",
      "Data de Abertura: 05/01/2007",
      "Periodo de Apuracao (PA): 06/2026",
      "Receita Bruta do PA (RPA) - Competencia",
      "11.722,00",
      "0,00",
      "11.722,00",
      "Receita bruta acumulada nos doze meses anteriores ao PA",
      "(RBT12)",
      "209.171,00",
      "0,00",
      "209.171,00",
      "Receita bruta acumulada no ano-calendario corrente (RBA)",
      "65.043,50",
      "0,00",
      "65.043,50",
      "Receita bruta acumulada no ano-calendario anterior",
      "(RBAA)",
      "234.033,50",
      "0,00",
      "234.033,50",
      "2.2.1) Mercado Interno",
      "06/2025",
      "16.920,00",
      "07/2025",
      "18.037,00",
      "05/2026",
      "11.278,00",
      "2.2.2) Mercado Externo",
      "06/2025",
      "0,00",
      "07/2025",
      "0,00",
      "05/2026",
      "0,00",
      "2.3) Folha de Salarios Anteriores (R$)",
      "Nenhuma",
      "2.4) Fator r",
      "Impedido de recolher ICMS/ISS no DAS: Nao",
      "CNPJ Estabelecimento: 08.585.649/0001-23",
      "Revenda de mercadorias, exceto para o exterior - Sem substituicao tributaria/tributacao monofasica",
      "Receita Bruta Informada: R$ 108,00",
      "Revenda de mercadorias, exceto para o exterior - Com substituicao tributaria/tributacao monofasica",
      "Receita Bruta Informada: R$ 11.614,00",
      "Parcela 1: R$ 338,00",
      "Substituicao tributaria de: ICMS.",
      "Parcela 2: R$ 11.276,00",
      "Substituicao tributaria de: ICMS.",
      "Tributacao monofasica de: COFINS, PIS.",
    ]);

    expect(data.companyName).toBe("A & C EVENTOS E PROMOCOES LTDA");
    expect(data.cnpj).toBe("08.585.649/0001-23");
    expect(data.openingDate).toBe("2007-01-05");
    expect(data.period).toBe("2026-06");
    expect(data.rpaInternal).toBe("11.722,00");
    expect(data.rbt12Internal).toBe("209.171,00");
    expect(data.currentYearBeforeInternal).toBe("53.321,50");
    expect(data.priorInternal).toBe("234.033,50");
    expect(data.monthlyInternal["2025-06"]).toBe("16.920,00");
    expect(data.monthlyInternal["2026-05"]).toBe("11.278,00");
    expect(data.monthlyExternal["2025-06"]).toBe("0,00");
    expect(data.impeded).toBe(false);
    expect(data.activities[0].annex).toBe("I");
    expect(data.activities[0].segments.icms_normal_pis_cofins_normal).toBe("108,00");
    expect(data.activities[0].segments.icms_st_pis_cofins_normal).toBe("338,00");
    expect(data.activities[0].segments.icms_st_pis_cofins_monofasico).toBe("11.276,00");
  });
});

describe("extractPdfTextLines", () => {
  it("le strings literais de PDF textual sem enviar dados para fora", async () => {
    const pdf = `%PDF-1.4
1 0 obj
<< /Length 105 >>
stream
BT
(Extrato do Simples Nacional)Tj
(Nome Empresarial: TESTE LTDA)Tj
(Periodo de Apuracao \\(PA\\): 06/2026)Tj
ET
endstream
endobj
%%EOF`;

    const lines = await extractPdfTextLines(new TextEncoder().encode(pdf).buffer);

    expect(lines).toContain("Extrato do Simples Nacional");
    expect(lines).toContain("Nome Empresarial: TESTE LTDA");
    expect(lines).toContain("Periodo de Apuracao (PA): 06/2026");
  });

  it("respeita o Length do stream quando endstream aparece no conteudo", async () => {
    const body = [
      "BT",
      "(Extrato do Simples Nacional)Tj",
      "(Nome Empresarial: TESTE endstream LTDA)Tj",
      "ET",
    ].join("\n");
    const pdf = `%PDF-1.4
1 0 obj
<< /Length ${body.length} >>
stream
${body}
endstream
endobj
%%EOF`;

    const lines = await extractPdfTextLines(new TextEncoder().encode(pdf).buffer);

    expect(lines).toContain("Extrato do Simples Nacional");
    expect(lines).toContain("Nome Empresarial: TESTE endstream LTDA");
  });

  it("ignora stream compactado invalido quando outro stream textual e lido", async () => {
    const bad = "nao-e-deflate";
    const good = [
      "BT",
      "(Extrato do Simples Nacional)Tj",
      "(Nome Empresarial: STREAM BOM LTDA)Tj",
      "ET",
    ].join("\n");
    const pdf = `%PDF-1.4
1 0 obj
<< /Filter /FlateDecode /Length ${bad.length} >>
stream
${bad}
endstream
endobj
2 0 obj
<< /Length ${good.length} >>
stream
${good}
endstream
endobj
%%EOF`;

    const lines = await extractPdfTextLines(
      new TextEncoder().encode(pdf).buffer,
      async () => {
        throw new Error("Failed to fetch");
      },
    );

    expect(lines).toContain("Extrato do Simples Nacional");
    expect(lines).toContain("Nome Empresarial: STREAM BOM LTDA");
  });

  it("descompacta FlateDecode com fallback JavaScript local", async () => {
    const body = [
      "BT",
      "(Extrato do Simples Nacional)Tj",
      "(Nome Empresarial: PDF COMPACTADO LTDA)Tj",
      "(Periodo de Apuracao \\(PA\\): 06/2026)Tj",
      "ET",
    ].join("\n");
    const compressed = zlibSync(new TextEncoder().encode(body));
    const pdf = concatBytes(
      new TextEncoder().encode(`%PDF-1.4
1 0 obj
<< /Filter /FlateDecode /Length ${compressed.length} >>
stream
`),
      compressed,
      new TextEncoder().encode(`
endstream
endobj
%%EOF`),
    );

    const lines = await extractPdfTextLines(toArrayBuffer(pdf));

    expect(lines).toContain("Extrato do Simples Nacional");
    expect(lines).toContain("Nome Empresarial: PDF COMPACTADO LTDA");
    expect(lines).toContain("Periodo de Apuracao (PA): 06/2026");
  });
});

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
