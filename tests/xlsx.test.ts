import { describe, expect, it } from "vitest";

import { buildXlsxBlob, XLSX_STYLES } from "../src/xlsx";

describe("buildXlsxBlob", () => {
  it("gera um xlsx OpenXML com assinatura zip e conteudo das abas", async () => {
    const blob = buildXlsxBlob([
      {
        name: "Resumo",
        rows: [
          ["Campo", "Valor"],
          ["Total do DAS", "R$ 1.234,56"],
        ],
      },
      {
        name: "Memoria",
        rows: [["Etapa", "Formula"]],
      },
    ]);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(text).toContain("xl/workbook.xml");
    expect(text).toContain('name="Resumo"');
    expect(text).toContain("Total do DAS");
    expect(text).toContain("R$ 1.234,56");
  });

  it("bloqueia workbook sem abas", () => {
    expect(() => buildXlsxBlob([])).toThrow("XLSX exige ao menos uma aba.");
  });

  it("inclui estilos institucionais da CTG", async () => {
    const blob = buildXlsxBlob([
      {
        name: "Resumo",
        columns: [32, 68],
        merges: ["A1:B1"],
        rows: [
          [{ value: "Simulador Simples Nacional", style: XLSX_STYLES.title }],
          [{ value: "Total do DAS", style: XLSX_STYLES.total }, "R$ 1.234,56"],
        ],
      },
    ]);

    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

    expect(text).toContain('fgColor rgb="FF012A48"');
    expect(text).toContain('fgColor rgb="FFFE582E"');
    expect(text).toContain('s="1"');
    expect(text).toContain('s="5"');
    expect(text).toContain('showGridLines="0"');
    expect(text).toContain('<col min="2" max="2" width="68"');
    expect(text).toContain('<mergeCell ref="A1:B1"/>');
  });
});
