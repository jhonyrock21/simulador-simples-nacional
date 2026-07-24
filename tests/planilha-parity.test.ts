import { describe, expect, it } from "vitest";

import {
  simulate,
  type RevenueSegmentCode,
  type SimulationInput,
} from "../src/calc";
import {
  ANNEX_RULES_2026,
  REVENUE_SEGMENTS_2026,
  TAXES,
  type Annex,
  type Band,
} from "../src/rules-2026";

// Reimplementa a aritmetica EXATA da planilha (aba Simulador), lendo as mesmas
// tabelas transcritas no motor:
//   AliqEfetiva = (RBT12 * AliqNominal - ParcelaDeduzir) / RBT12
//   Tributo_t   = AliqEfetiva * reparticao_t * SUMPRODUCT(segmentos, incidencia_t)
//   Total       = round(soma dos tributos)  [centavos]
// So vale para os casos sem o teto de 5% do ISS e fora da faixa 6, que sao
// justamente onde a planilha e o motor devem coincidir centavo a centavo.
function spreadsheetTotalCents(
  annex: Annex,
  band: Band,
  rbt12Cents: number,
  segments: Partial<Record<RevenueSegmentCode, number>>,
): number {
  const rule = ANNEX_RULES_2026.find((r) => r.annex === annex && r.band === band);
  if (!rule) throw new Error(`sem regra ${annex}-${band}`);
  const aliqEf = (rbt12Cents * Number(rule.nominalRate) - rule.deductionCents) / rbt12Cents;

  let rawTotal = 0;
  for (const tax of TAXES) {
    const rateT = aliqEf * Number(rule.shares[tax]);
    let base = 0;
    for (const seg of REVENUE_SEGMENTS_2026) {
      const value = segments[seg.code as RevenueSegmentCode] ?? 0;
      base += value * seg.incidence[tax];
    }
    rawTotal += rateT * base;
  }
  return Math.round(rawTotal);
}

const PERIODS_2025 = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

function established(
  annex: Annex,
  rbt12Cents: number,
  segments: Partial<Record<RevenueSegmentCode, number>>,
): SimulationInput {
  const current = Object.values(segments).reduce((s, v) => s + (v ?? 0), 0);
  return {
    rulePeriod: "2026-01",
    company: { openingDate: "2020-01-10" },
    revenueHistory: PERIODS_2025.map((period, i) => ({
      period,
      internalCents: i === 11 ? rbt12Cents : 0,
      externalCents: 0,
    })),
    currentPeriodRevenue: { internalCents: current, externalCents: 0 },
    payroll: {},
    sublimit: {
      priorYearInternalRevenueCents: rbt12Cents,
      priorYearExternalRevenueCents: 0,
      currentYearInternalRevenueBeforePeriodCents: 0,
      currentYearExternalRevenueBeforePeriodCents: 0,
      impededAtPeriodStart: false,
    },
    activities: [{
      id: "a1",
      description: "atividade",
      annexMode: "manual",
      selectedAnnex: annex,
      declaredRevenueCents: current,
      segments,
    }],
  };
}

const PRODUCT: RevenueSegmentCode = "icms_normal_pis_cofins_normal";
const SERVICE: RevenueSegmentCode = "iss_normal";

// (annex, band, rbt12 dentro da faixa, segmentos) — todos sem teto de ISS.
const CASES: Array<[Annex, Band, number, Partial<Record<RevenueSegmentCode, number>>]> = [
  ["I", 1, 10_000_000, { [PRODUCT]: 100_000 }],
  ["I", 2, 25_000_000, { [PRODUCT]: 100_000 }],
  ["I", 3, 50_000_000, { [PRODUCT]: 100_000 }],
  ["I", 4, 152_228_418, {
    icms_normal_pis_cofins_normal: 17_936_140,
    icms_st_pis_cofins_normal: 1_852_355,
    icms_st_pis_cofins_monofasico: 25_764_238,
  }],
  ["I", 5, 300_000_000, { [PRODUCT]: 100_000 }],
  ["II", 3, 50_000_000, { [PRODUCT]: 100_000 }],
  ["III", 1, 10_000_000, { [SERVICE]: 100_000 }],
  ["III", 3, 50_000_000, { [SERVICE]: 100_000 }],
  ["IV", 1, 10_000_000, { [SERVICE]: 100_000 }],
  ["V", 5, 300_000_000, { [SERVICE]: 100_000 }], // topo da faixa 5: ISS 4,9996% (sem teto)
];

describe("paridade com a planilha (casos sem teto de ISS / faixa 6)", () => {
  it("o total do DAS do motor bate com a formula da planilha", () => {
    for (const [annex, band, rbt12, segments] of CASES) {
      const result = simulate(established(annex, rbt12, segments));
      expect(result.ok, `${annex}-${band}`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.activities[0].band, `${annex}-${band}`).toBe(band);
      expect(result.value.totalDasCents, `${annex}-${band}`).toBe(
        spreadsheetTotalCents(annex, band, rbt12, segments),
      );
    }
  });

  it("no teto de ISS (Anexo III/IV faixa 5) o TOTAL ainda bate; muda so a destinacao", () => {
    for (const annex of ["III", "IV"] as const) {
      const segments = { iss_normal: 100_000 };
      const rbt12 = 360_000_000; // topo da faixa 5, onde o ISS efetivo passa de 5%
      const result = simulate(established(annex, rbt12, segments));
      expect(result.ok, annex).toBe(true);
      if (!result.ok) continue;
      expect(result.value.activities[0].band, annex).toBe(5);
      // A redistribuicao do excedente preserva o total: bate com a planilha.
      expect(result.value.totalDasCents, `${annex} total`).toBe(
        spreadsheetTotalCents(annex, 5, rbt12, segments),
      );
      // Mas o motor aplica o teto (a planilha nao): ISS limitado a ~5% da receita.
      expect(result.value.activities[0].segments[0].issCapApplied, annex).toBe(true);
      expect(result.value.byTaxCents.iss, `${annex} iss`).toBeLessThanOrEqual(5_001);
    }
  });

  it("o exemplo trabalhado da planilha fecha em R$ 29.794,04", () => {
    const result = simulate(established("I", 152_228_418, {
      icms_normal_pis_cofins_normal: 17_936_140,
      icms_st_pis_cofins_normal: 1_852_355,
      icms_st_pis_cofins_monofasico: 25_764_238,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalDasCents).toBe(2_979_404);
  });
});
