import Decimal from "decimal.js-light";
import { describe, expect, it } from "vitest";

import {
  calculateFactorR,
  selectRevenueBand,
  simulate,
  type RevenueSegmentCode,
  type SimulationInput,
} from "../src/calc";
import { TAXES, type Annex, type Tax } from "../src/rules-2026";

const PERIODS_2025 = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

function establishedSimulation(params: {
  rbt12Cents: number;
  annex: Annex;
  segments: Partial<Record<RevenueSegmentCode, number>>;
  internalCents: number;
  externalCents?: number;
}): SimulationInput {
  const externalCents = params.externalCents ?? 0;
  return {
    rulePeriod: "2026-01",
    company: { openingDate: "2020-01-10" },
    revenueHistory: PERIODS_2025.map((period, index) => ({
      period,
      internalCents: index === PERIODS_2025.length - 1 ? params.rbt12Cents : 0,
      externalCents: 0,
    })),
    currentPeriodRevenue: { internalCents: params.internalCents, externalCents },
    payroll: {},
    sublimit: {
      priorYearInternalRevenueCents: params.rbt12Cents,
      priorYearExternalRevenueCents: 0,
      currentYearInternalRevenueBeforePeriodCents: 0,
      currentYearExternalRevenueBeforePeriodCents: 0,
      impededAtPeriodStart: false,
    },
    activities: [
      {
        id: "a1",
        description: "atividade",
        annexMode: "manual",
        selectedAnnex: params.annex,
        declaredRevenueCents: params.internalCents + externalCents,
        segments: params.segments,
      },
    ],
  };
}

function issueCodes(result: ReturnType<typeof simulate>): string[] {
  return result.ok ? [] : result.errors.map(({ code }) => code);
}

// ---------------------------------------------------------------------------
// Grupo 1 - Faixas: fronteiras em centavos
// ---------------------------------------------------------------------------

describe("Fase 1 - fronteiras das seis faixas", () => {
  it("resolve cada teto exato, o centavo seguinte e o limite geral", () => {
    // zero e faixa 1
    expect(selectRevenueBand(0)).toBe(1);
    // cada teto exato pertence a propria faixa
    expect(selectRevenueBand(18_000_000)).toBe(1);
    expect(selectRevenueBand(36_000_000)).toBe(2);
    expect(selectRevenueBand(72_000_000)).toBe(3);
    expect(selectRevenueBand(180_000_000)).toBe(4);
    expect(selectRevenueBand(360_000_000)).toBe(5);
    expect(selectRevenueBand(480_000_000)).toBe(6);
    // um centavo acima de cada teto sobe de faixa
    expect(selectRevenueBand(18_000_001)).toBe(2);
    expect(selectRevenueBand(36_000_001)).toBe(3);
    expect(selectRevenueBand(72_000_001)).toBe(4);
    expect(selectRevenueBand(180_000_001)).toBe(5);
    expect(selectRevenueBand(360_000_001)).toBe(6);
    // R$ 4.800.000,01 esta fora do escopo liberado
    expect(selectRevenueBand(480_000_001)).toBeNull();
    expect(selectRevenueBand(-1)).toBeNull();
  });

  it("liga a base de enquadramento a faixa correta dentro do motor", () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [18_000_000, 1],
      [18_000_001, 2],
      [36_000_000, 2],
      [36_000_001, 3],
      [72_000_000, 3],
      [72_000_001, 4],
      [180_000_000, 4],
      [180_000_001, 5],
      [360_000_000, 5],
      [360_000_001, 6],
      [480_000_000, 6],
    ];

    for (const [rbt12Cents, expectedBand] of cases) {
      const result = simulate(establishedSimulation({
        rbt12Cents,
        annex: "I",
        segments: { icms_normal_pis_cofins_normal: 100_000 },
        internalCents: 100_000,
      }));

      expect(result.ok, `rbt12=${rbt12Cents}`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.activities[0].band, `rbt12=${rbt12Cents}`).toBe(expectedBand);
    }
  });

  it("bloqueia a base que supera R$ 4.800.000,00", () => {
    const input: SimulationInput = {
      rulePeriod: "2026-12",
      company: { openingDate: "2026-12-01" },
      revenueHistory: [],
      currentPeriodRevenue: { internalCents: 40_000_001, externalCents: 0 },
      payroll: {},
      sublimit: {
        priorYearInternalRevenueCents: 0,
        priorYearExternalRevenueCents: 0,
        currentYearInternalRevenueBeforePeriodCents: 0,
        currentYearExternalRevenueBeforePeriodCents: 0,
        impededAtPeriodStart: false,
      },
      activities: [
        {
          id: "a1",
          description: "atividade",
          annexMode: "manual",
          selectedAnnex: "I",
          declaredRevenueCents: 40_000_001,
          segments: { icms_normal_pis_cofins_normal: 40_000_001 },
        },
      ],
    };

    // 40.000.001 * 12 = 480.000.012 centavos de base proporcionalizada.
    expect(issueCodes(simulate(input))).toContain("GROSS_REVENUE_LIMIT_EXCEEDED");
  });
});

// ---------------------------------------------------------------------------
// Grupo 2 - Inicio de atividade: 2o, 3o, 12o e 13o mes
// ---------------------------------------------------------------------------

describe("Fase 1 - inicio de atividade", () => {
  it("anualiza um unico mes anterior no segundo mes de atividade", () => {
    const input: SimulationInput = {
      rulePeriod: "2026-02",
      company: { openingDate: "2026-01-10" },
      revenueHistory: [{ period: "2026-01", internalCents: 150_000, externalCents: 0 }],
      currentPeriodRevenue: { internalCents: 100_000, externalCents: 0 },
      payroll: {},
      sublimit: {
        priorYearInternalRevenueCents: 0,
        priorYearExternalRevenueCents: 0,
        currentYearInternalRevenueBeforePeriodCents: 150_000,
        currentYearExternalRevenueBeforePeriodCents: 0,
        impededAtPeriodStart: false,
      },
      activities: [
        {
          id: "a1",
          description: "comercio",
          annexMode: "manual",
          selectedAnnex: "I",
          declaredRevenueCents: 100_000,
          segments: { icms_normal_pis_cofins_normal: 100_000 },
        },
      ],
    };

    const result = simulate(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.monthsBeforePeriod).toBe(1);
    expect(result.value.revenueBasis.mode).toBe("startup-proportionalized");
    // 150.000 / 1 * 12
    expect(result.value.revenueBasis.rateBaseCents).toBe("1800000");
    expect(result.value.activities[0].band).toBe(1);
  });

  it("conta meses sem receita no divisor ao chegar ao decimo segundo mes", () => {
    const history = [
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ].map((period) => ({
      // toda a receita concentrada no ultimo mes anterior; dez meses ficam zerados
      period,
      internalCents: period === "2026-11" ? 1_100_000 : 0,
      externalCents: 0,
    }));

    const input: SimulationInput = {
      rulePeriod: "2026-12",
      company: { openingDate: "2026-01-10" },
      revenueHistory: history,
      currentPeriodRevenue: { internalCents: 100_000, externalCents: 0 },
      payroll: {},
      sublimit: {
        priorYearInternalRevenueCents: 0,
        priorYearExternalRevenueCents: 0,
        currentYearInternalRevenueBeforePeriodCents: 1_100_000,
        currentYearExternalRevenueBeforePeriodCents: 0,
        impededAtPeriodStart: false,
      },
      activities: [
        {
          id: "a1",
          description: "comercio",
          annexMode: "manual",
          selectedAnnex: "I",
          declaredRevenueCents: 100_000,
          segments: { icms_normal_pis_cofins_normal: 100_000 },
        },
      ],
    };

    const result = simulate(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.monthsBeforePeriod).toBe(11);
    expect(result.value.revenueBasis.mode).toBe("startup-proportionalized");
    // 1.100.000 / 11 * 12 = 1.200.000
    expect(result.value.revenueBasis.rateBaseCents).toBe("1200000");
    expect(result.value.revenueBasis.periods).toHaveLength(11);
  });

  it("usa a soma exata dos doze meses a partir do decimo terceiro mes", () => {
    const history = [
      "2025-12",
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ].map((period) => ({
      period,
      internalCents: period === "2025-12" || period === "2026-06" ? 100_000 : 0,
      externalCents: 0,
    }));

    const input: SimulationInput = {
      rulePeriod: "2026-12",
      company: { openingDate: "2025-12-10" },
      revenueHistory: history,
      currentPeriodRevenue: { internalCents: 100_000, externalCents: 0 },
      payroll: {},
      sublimit: {
        priorYearInternalRevenueCents: 100_000,
        priorYearExternalRevenueCents: 0,
        currentYearInternalRevenueBeforePeriodCents: 100_000,
        currentYearExternalRevenueBeforePeriodCents: 0,
        impededAtPeriodStart: false,
      },
      activities: [
        {
          id: "a1",
          description: "comercio",
          annexMode: "manual",
          selectedAnnex: "I",
          declaredRevenueCents: 100_000,
          segments: { icms_normal_pis_cofins_normal: 100_000 },
        },
      ],
    };

    const result = simulate(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.monthsBeforePeriod).toBe(12);
    expect(result.value.revenueBasis.mode).toBe("rbt12");
    // 100.000 + 100.000, sem proporcionalizar
    expect(result.value.revenueBasis.rateBaseCents).toBe("200000");
    expect(result.value.revenueBasis.periods).toHaveLength(12);
    expect(result.value.sublimit.startupYear).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grupo 3 - Fator R: fronteiras e bases zeradas
// ---------------------------------------------------------------------------

function firstPeriodFactorSimulation(payrollCents: number, revenueCents = 100_000): SimulationInput {
  return {
    rulePeriod: "2026-01",
    company: { openingDate: "2026-01-15" },
    revenueHistory: [],
    currentPeriodRevenue: { internalCents: revenueCents, externalCents: 0 },
    payroll: { currentPeriodCents: payrollCents },
    sublimit: {
      priorYearInternalRevenueCents: 0,
      priorYearExternalRevenueCents: 0,
      currentYearInternalRevenueBeforePeriodCents: 0,
      currentYearExternalRevenueBeforePeriodCents: 0,
      impededAtPeriodStart: false,
    },
    activities: [
      {
        id: "servico",
        description: "servico sujeito ao Fator R",
        annexMode: "factor-r",
        declaredRevenueCents: revenueCents,
        segments: { iss_normal: revenueCents },
      },
    ],
  };
}

function thirdMonthFactorSimulation(payrollJanCents: number): SimulationInput {
  return {
    rulePeriod: "2026-03",
    company: { openingDate: "2026-01-10" },
    revenueHistory: [
      { period: "2026-01", internalCents: 100_000, externalCents: 0 },
      { period: "2026-02", internalCents: 0, externalCents: 0 },
    ],
    currentPeriodRevenue: { internalCents: 100_000, externalCents: 0 },
    payroll: {
      history: [
        { period: "2026-01", valueCents: payrollJanCents },
        { period: "2026-02", valueCents: 0 },
      ],
    },
    sublimit: {
      priorYearInternalRevenueCents: 0,
      priorYearExternalRevenueCents: 0,
      currentYearInternalRevenueBeforePeriodCents: 100_000,
      currentYearExternalRevenueBeforePeriodCents: 0,
      impededAtPeriodStart: false,
    },
    activities: [
      {
        id: "servico",
        description: "servico sujeito ao Fator R",
        annexMode: "factor-r",
        declaredRevenueCents: 100_000,
        segments: { iss_normal: 100_000 },
      },
    ],
  };
}

describe("Fase 1 - Fator R nas fronteiras de 28%", () => {
  it("aplica as bases zeradas e as fronteiras no primeiro periodo", () => {
    expect(calculateFactorR(0, 0, true)).toBeNull();
    expect(calculateFactorR(28_000, 0, true)).toBe("0.28");
    expect(calculateFactorR(0, 100_000, true)).toBe("0.01");
    expect(calculateFactorR(27_999, 100_000, true)).toBe("0.27999");
    expect(calculateFactorR(28_000, 100_000, true)).toBe("0.28");
    expect(calculateFactorR(30_000, 100_000, true)).toBe("0.3");
  });

  it("aplica as bases zeradas e as fronteiras nos periodos posteriores", () => {
    expect(calculateFactorR(0, 0, false)).toBe("0.01");
    expect(calculateFactorR(28_000, 0, false)).toBe("0.28");
    expect(calculateFactorR(0, 100_000, false)).toBe("0.01");
    expect(calculateFactorR(27_999, 100_000, false)).toBe("0.27999");
    expect(calculateFactorR(28_000, 100_000, false)).toBe("0.28");
    expect(calculateFactorR(30_000, 100_000, false)).toBe("0.3");
  });

  it("seleciona Anexo III acima de 28% no primeiro periodo", () => {
    const result = simulate(firstPeriodFactorSimulation(30_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factorR).toBe("0.3");
    expect(result.value.activities[0].annex).toBe("III");
  });

  it("seleciona Anexo III exatamente em 28% em periodo posterior", () => {
    const result = simulate(thirdMonthFactorSimulation(28_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factorR).toBe("0.28");
    expect(result.value.activities[0].annex).toBe("III");
  });

  it("seleciona Anexo V abaixo de 28% em periodo posterior", () => {
    const result = simulate(thirdMonthFactorSimulation(20_000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factorR).toBe("0.2");
    expect(result.value.activities[0].annex).toBe("V");
  });
});

// ---------------------------------------------------------------------------
// Grupo 4 - Segregacao: dez segmentos isolados
// ---------------------------------------------------------------------------

function singleSegment(annex: Annex, segment: RevenueSegmentCode, revenueCents: number): SimulationInput {
  const isExport = segment === "exportacao";
  return establishedSimulation({
    rbt12Cents: 10_000_000,
    annex,
    segments: { [segment]: revenueCents },
    internalCents: isExport ? 0 : revenueCents,
    externalCents: isExport ? revenueCents : 0,
  });
}

describe("Fase 1 - segregacao por segmento", () => {
  const REVENUE = 1_000_000;

  const cases: Array<{
    annex: Annex;
    segment: RevenueSegmentCode;
    positive: Tax[];
    zero: Tax[];
  }> = [
    {
      annex: "II",
      segment: "icms_normal_pis_cofins_normal",
      positive: ["irpj", "csll", "cofins", "pis", "cpp", "icms", "ipi"],
      zero: ["iss"],
    },
    {
      annex: "II",
      segment: "icms_normal_pis_cofins_monofasico",
      positive: ["irpj", "csll", "cpp", "icms", "ipi"],
      zero: ["cofins", "pis", "iss"],
    },
    {
      annex: "II",
      segment: "icms_st_pis_cofins_normal",
      positive: ["irpj", "csll", "cofins", "pis", "cpp", "ipi"],
      zero: ["icms", "iss"],
    },
    {
      annex: "II",
      segment: "icms_st_pis_cofins_monofasico",
      positive: ["irpj", "csll", "cpp", "ipi"],
      zero: ["cofins", "pis", "icms", "iss"],
    },
    {
      annex: "II",
      segment: "icms_isento_pis_cofins_normal",
      positive: ["irpj", "csll", "cofins", "pis", "cpp", "ipi"],
      zero: ["icms", "iss"],
    },
    {
      annex: "II",
      segment: "icms_isento_pis_cofins_monofasico",
      positive: ["irpj", "csll", "cpp", "ipi"],
      zero: ["cofins", "pis", "icms", "iss"],
    },
    {
      annex: "III",
      segment: "iss_normal",
      positive: ["irpj", "csll", "cofins", "pis", "cpp", "iss"],
      zero: ["icms", "ipi"],
    },
    {
      annex: "III",
      segment: "iss_isento_imune",
      positive: ["irpj", "csll", "cofins", "pis", "cpp"],
      zero: ["icms", "ipi", "iss"],
    },
    {
      annex: "III",
      segment: "iss_retido",
      positive: ["irpj", "csll", "cofins", "pis", "cpp"],
      zero: ["icms", "ipi", "iss"],
    },
    {
      annex: "II",
      segment: "exportacao",
      positive: ["irpj", "csll", "cpp"],
      zero: ["cofins", "pis", "icms", "ipi", "iss"],
    },
  ];

  it("cobre os dez segmentos e retira exatamente os tributos dispensados", () => {
    // cada segmento aparece uma unica vez
    expect(new Set(cases.map(({ segment }) => segment)).size).toBe(10);

    for (const { annex, segment, positive, zero } of cases) {
      // positivos e zerados juntos cobrem os oito tributos
      expect([...positive, ...zero].sort(), segment).toEqual([...TAXES].sort());

      const result = simulate(singleSegment(annex, segment, REVENUE));
      expect(result.ok, segment).toBe(true);
      if (!result.ok) continue;

      const byTax = result.value.activities[0].byTaxCents;
      for (const tax of zero) {
        expect(byTax[tax], `${segment}:${tax}`).toBe(0);
      }
      for (const tax of positive) {
        expect(byTax[tax], `${segment}:${tax}`).toBeGreaterThan(0);
      }
    }
  });

  it("combina monofasico com ST e com isencao retirando ICMS, PIS e COFINS juntos", () => {
    const st = simulate(singleSegment("II", "icms_st_pis_cofins_monofasico", REVENUE));
    const isento = simulate(singleSegment("II", "icms_isento_pis_cofins_monofasico", REVENUE));

    expect(st.ok).toBe(true);
    expect(isento.ok).toBe(true);
    if (!st.ok || !isento.ok) return;

    for (const result of [st, isento]) {
      const byTax = result.value.activities[0].byTaxCents;
      expect(byTax.icms).toBe(0);
      expect(byTax.pis).toBe(0);
      expect(byTax.cofins).toBe(0);
      expect(byTax.ipi).toBeGreaterThan(0);
      expect(byTax.cpp).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Grupo 5 - Teto de ISS de 5%
// ---------------------------------------------------------------------------

describe("Fase 1 - teto de 5% do ISS", () => {
  it("nao aplica o teto quando o ISS efetivo fica abaixo de 5% (Anexo III, faixa 1)", () => {
    const result = simulate(establishedSimulation({
      rbt12Cents: 10_000_000,
      annex: "III",
      segments: { iss_normal: 100_000 },
      internalCents: 100_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities[0].band).toBe(1);
    expect(result.value.activities[0].segments[0].issCapApplied).toBe(false);
    // ISS efetivo = 6% * 33,5% = 2,01% da receita
    expect(result.value.activities[0].byTaxCents.iss).toBe(2_010);
  });

  it("aplica o teto e redistribui aos federais quando o ISS passa de 5% (Anexo IV, faixa 5)", () => {
    const normal = simulate(establishedSimulation({
      rbt12Cents: 360_000_000,
      annex: "IV",
      segments: { iss_normal: 100_000 },
      internalCents: 100_000,
    }));
    const retained = simulate(establishedSimulation({
      rbt12Cents: 360_000_000,
      annex: "IV",
      segments: { iss_retido: 100_000 },
      internalCents: 100_000,
    }));

    expect(normal.ok).toBe(true);
    expect(retained.ok).toBe(true);
    if (!normal.ok || !retained.ok) return;

    expect(normal.value.activities[0].band).toBe(5);
    expect(normal.value.activities[0].segments[0].issCapApplied).toBe(true);
    // sem teto o ISS passaria de R$ 67,00; com o teto fica em torno de R$ 50,00
    expect(normal.value.activities[0].byTaxCents.iss).toBeLessThanOrEqual(5_001);
    expect(normal.value.activities[0].byTaxCents.iss).toBeGreaterThanOrEqual(4_999);
    // Anexo IV nao possui CPP, entao a redistribuicao nao cria CPP
    expect(normal.value.activities[0].byTaxCents.cpp).toBe(0);
    // com o ISS retido nao ha teto nem redistribuicao, logo menos tributo federal
    expect(retained.value.activities[0].segments[0].issCapApplied).toBe(false);
    expect(retained.value.activities[0].byTaxCents.iss).toBe(0);
    expect(normal.value.destinations.federalCents)
      .toBeGreaterThan(retained.value.destinations.federalCents);
  });

  it("mantem o ISS do Anexo V abaixo de 5% mesmo no topo da faixa 5", () => {
    const result = simulate(establishedSimulation({
      rbt12Cents: 360_000_000,
      annex: "V",
      segments: { iss_normal: 100_000 },
      internalCents: 100_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities[0].band).toBe(5);
    // 21,275% * 23,5% = 4,999625% < 5%, entao o teto nunca dispara no Anexo V de 2026
    expect(result.value.activities[0].segments[0].issCapApplied).toBe(false);
    expect(result.value.activities[0].byTaxCents.iss).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Grupo 6 - Reconciliacao de centavos e campos obrigatorios
// ---------------------------------------------------------------------------

function regressionInput(): SimulationInput {
  const input = establishedSimulation({
    rbt12Cents: 152_228_418,
    annex: "I",
    segments: {
      icms_normal_pis_cofins_normal: 17_936_140,
      icms_st_pis_cofins_normal: 1_852_355,
      icms_st_pis_cofins_monofasico: 25_764_238,
    },
    internalCents: 45_552_733,
  });
  return input;
}

describe("Fase 1 - reconciliacao de centavos", () => {
  it("transfere a diferenca de R$ 0,01 ao maior tributo sem perder centavos", () => {
    const result = simulate(regressionInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const activity = result.value.activities[0];
    const byTax = activity.byTaxCents;

    // a soma dos tributos reconciliados fecha exatamente com o total exibido
    const sum = TAXES.reduce((total, tax) => total + byTax[tax], 0);
    expect(sum).toBe(activity.totalCents);
    expect(activity.totalCents).toBe(2_979_404);
    expect(result.value.totalDasCents).toBe(2_979_404);

    // arredondando cada segmento de CPP isoladamente daria 1.764.359...
    const cppRawRounded = activity.segments
      .reduce((total, segment) => total.plus(segment.rawTaxCents.cpp), new Decimal(0))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    expect(cppRawRounded).toBe(1_764_359);
    // ...mas o motor tira um centavo do maior tributo para fechar o total
    expect(byTax.cpp).toBe(1_764_358);
  });

  it("bloqueia campo monetario obrigatorio ausente na receita do periodo", () => {
    const input = regressionInput();
    (input.currentPeriodRevenue as { internalCents?: number }).internalCents = undefined;

    expect(issueCodes(simulate(input))).toContain("INVALID_MONEY");
  });

  it("bloqueia receita declarada da atividade ausente", () => {
    const input = regressionInput();
    (input.activities[0] as { declaredRevenueCents?: number }).declaredRevenueCents = undefined;

    expect(issueCodes(simulate(input))).toContain("INVALID_MONEY");
  });

  it("bloqueia valor de segmento ausente", () => {
    const input = regressionInput();
    (input.activities[0].segments as Record<string, number | undefined>)
      .icms_normal_pis_cofins_normal = undefined;

    expect(issueCodes(simulate(input))).toContain("INVALID_MONEY");
  });
});
