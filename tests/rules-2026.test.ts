import { describe, expect, it } from "vitest";

import {
  ANNEX_DESCRIPTIONS_2026,
  ANNEXES,
  ANNEX_RULES_2026,
  ISS_EXCESS_REDISTRIBUTION_2026,
  REVENUE_BANDS_2026,
  REVENUE_SEGMENTS_2026,
  RULESET_2026,
  TAXES,
} from "../src/rules-2026";

function decimalToMillionths(value: string): number {
  const [whole, fraction = ""] = value.split(".");

  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > 6) {
    throw new Error(`Decimal invalido no conjunto de regras: ${value}`);
  }

  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
}

describe("regras do Simples Nacional para 2026", () => {
  it("restringe a vigencia e os limites monetarios ao escopo aprovado", () => {
    expect(RULESET_2026.period).toEqual({ from: "2026-01", through: "2026-12" });
    expect(RULESET_2026.maximumGrossRevenueCents).toBe(480_000_000);
    expect(RULESET_2026.stateAndMunicipalSublimitCents).toBe(360_000_000);
    expect(RULESET_2026.factorRThreshold).toBe("0.28");
    expect(RULESET_2026.issRateCap).toBe("0.05");
  });

  it("mantem as seis faixas contiguas em centavos", () => {
    expect(REVENUE_BANDS_2026).toEqual([
      { band: 1, lowerExclusiveCents: null, upperInclusiveCents: 18_000_000 },
      { band: 2, lowerExclusiveCents: 18_000_000, upperInclusiveCents: 36_000_000 },
      { band: 3, lowerExclusiveCents: 36_000_000, upperInclusiveCents: 72_000_000 },
      { band: 4, lowerExclusiveCents: 72_000_000, upperInclusiveCents: 180_000_000 },
      { band: 5, lowerExclusiveCents: 180_000_000, upperInclusiveCents: 360_000_000 },
      { band: 6, lowerExclusiveCents: 360_000_000, upperInclusiveCents: 480_000_000 },
    ]);
  });

  it("possui exatamente uma regra para cada um dos 30 pares anexo/faixa", () => {
    const keys = ANNEX_RULES_2026.map(({ annex, band }) => `${annex}-${band}`);
    const expectedKeys = ANNEXES.flatMap((annex) =>
      [1, 2, 3, 4, 5, 6].map((band) => `${annex}-${band}`),
    );

    expect(keys).toEqual(expectedKeys);
    expect(new Set(keys).size).toBe(30);
  });

  it("preserva as descricoes funcionais dos cinco anexos", () => {
    expect(ANNEX_DESCRIPTIONS_2026).toEqual({
      I: "Comércio",
      II: "Indústria",
      III: "Serviços (menor complexidade técnica)",
      IV: "Serviços (construção, limpeza, vigilância, advocacia — CPP fora do DAS)",
      V: "Serviços intelectuais/técnicos (Fator R < 28%)",
    });
  });

  it("preserva aliquotas nominais e parcelas a deduzir da tabela auditada", () => {
    const expected = [
      ["I", 1, "0.04", 0], ["I", 2, "0.073", 594_000],
      ["I", 3, "0.095", 1_386_000], ["I", 4, "0.107", 2_250_000],
      ["I", 5, "0.143", 8_730_000], ["I", 6, "0.19", 37_800_000],
      ["II", 1, "0.045", 0], ["II", 2, "0.078", 594_000],
      ["II", 3, "0.1", 1_386_000], ["II", 4, "0.112", 2_250_000],
      ["II", 5, "0.147", 8_550_000], ["II", 6, "0.3", 72_000_000],
      ["III", 1, "0.06", 0], ["III", 2, "0.112", 936_000],
      ["III", 3, "0.135", 1_764_000], ["III", 4, "0.16", 3_564_000],
      ["III", 5, "0.21", 12_564_000], ["III", 6, "0.33", 64_800_000],
      ["IV", 1, "0.045", 0], ["IV", 2, "0.09", 810_000],
      ["IV", 3, "0.102", 1_242_000], ["IV", 4, "0.14", 3_978_000],
      ["IV", 5, "0.22", 18_378_000], ["IV", 6, "0.33", 82_800_000],
      ["V", 1, "0.155", 0], ["V", 2, "0.18", 450_000],
      ["V", 3, "0.195", 990_000], ["V", 4, "0.205", 1_710_000],
      ["V", 5, "0.23", 6_210_000], ["V", 6, "0.305", 54_000_000],
    ];

    expect(
      ANNEX_RULES_2026.map(({ annex, band, nominalRate, deductionCents }) => [
        annex,
        band,
        nominalRate,
        deductionCents,
      ]),
    ).toEqual(expected);
  });

  it("fecha em 100% a reparticao de cada anexo e faixa", () => {
    for (const rule of ANNEX_RULES_2026) {
      const total = TAXES.reduce(
        (sum, tax) => sum + decimalToMillionths(rule.shares[tax]),
        0,
      );

      expect(total, `${rule.annex}-${rule.band}`).toBe(1_000_000);
    }
  });

  it("preserva a faixa 4 do Anexo I usada no caso de regressao da planilha", () => {
    const rule = ANNEX_RULES_2026.find(({ annex, band }) => annex === "I" && band === 4);

    expect(rule).toMatchObject({
      nominalRate: "0.107",
      deductionCents: 2_250_000,
      shares: {
        irpj: "0.055",
        csll: "0.035",
        cofins: "0.1274",
        pis: "0.0276",
        cpp: "0.42",
        icms: "0.335",
        ipi: "0",
        iss: "0",
      },
    });
  });

  it("fecha em 100% cada redistribuicao do excedente de ISS", () => {
    for (const weights of Object.values(ISS_EXCESS_REDISTRIBUTION_2026)) {
      const total = Object.values(weights).reduce(
        (sum, value) => sum + decimalToMillionths(value),
        0,
      );

      expect(total).toBe(1_000_000);
    }
  });

  it("mantem os dez segmentos e uma decisao binaria por tributo", () => {
    expect(REVENUE_SEGMENTS_2026).toHaveLength(10);
    expect(new Set(REVENUE_SEGMENTS_2026.map(({ code }) => code)).size).toBe(10);

    for (const segment of REVENUE_SEGMENTS_2026) {
      expect(Object.keys(segment.incidence)).toEqual([...TAXES]);
      expect(Object.values(segment.incidence).every((value) => value === 0 || value === 1)).toBe(true);
    }
  });

  it("retira apenas os tributos previstos nas qualificacoes combinadas", () => {
    const monofasicoComSt = REVENUE_SEGMENTS_2026.find(
      ({ code }) => code === "icms_st_pis_cofins_monofasico",
    );
    const exportacao = REVENUE_SEGMENTS_2026.find(({ code }) => code === "exportacao");

    expect(monofasicoComSt?.incidence).toMatchObject({ cofins: 0, pis: 0, icms: 0 });
    expect(exportacao?.incidence).toEqual({
      irpj: 1,
      csll: 1,
      cofins: 0,
      pis: 0,
      cpp: 1,
      icms: 0,
      ipi: 0,
      iss: 0,
    });
  });

  it("registra a origem normativa e a planilha auditada", () => {
    expect(RULESET_2026.sources.map(({ id }) => id)).toEqual([
      "lc-123-2006",
      "resolucao-cgsn-140-2018",
      "sublimite-2026",
      "manual-pgdas-d",
    ]);
    expect(RULESET_2026.workbookReference.sha256).toBe(
      "0763D14577C384B88D64881B1F83878732FAB3E7AE82EC01B97A2C77D91C4D1D",
    );
    expect(RULESET_2026.workbookReference.ranges).toEqual({
      revenueBands: "A6:D11",
      annexRules: "A16:N45",
      revenueSegments: "A50:I59",
    });
  });
});
