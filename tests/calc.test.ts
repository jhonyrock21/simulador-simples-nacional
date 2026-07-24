import { describe, expect, it } from "vitest";

import {
  calculateEffectiveRate,
  calculateFactorR,
  selectRevenueBand,
  simulate,
  type SimulationInput,
} from "../src/calc";

const PERIODS_2025 = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

function historyWithTotal(totalCents: number) {
  return PERIODS_2025.map((period, index) => ({
    period,
    internalCents: index === PERIODS_2025.length - 1 ? totalCents : 0,
    externalCents: 0,
  }));
}

function manualSimulation(options: {
  rbt12Cents?: number;
  currentRevenueCents?: number;
  annex?: "I" | "II" | "III" | "IV" | "V";
  segment?: "icms_normal_pis_cofins_normal" | "iss_normal" | "iss_retido";
} = {}): SimulationInput {
  const rbt12Cents = options.rbt12Cents ?? 10_000_000;
  const currentRevenueCents = options.currentRevenueCents ?? 100_000;
  const annex = options.annex ?? "I";
  const segment = options.segment ?? (annex === "I" || annex === "II"
    ? "icms_normal_pis_cofins_normal"
    : "iss_normal");

  return {
    rulePeriod: "2026-01",
    company: { openingDate: "2020-01-10" },
    revenueHistory: historyWithTotal(rbt12Cents),
    currentPeriodRevenue: { internalCents: currentRevenueCents, externalCents: 0 },
    payroll: {},
    sublimit: {
      priorYearInternalRevenueCents: rbt12Cents,
      priorYearExternalRevenueCents: 0,
      currentYearInternalRevenueBeforePeriodCents: 0,
      currentYearExternalRevenueBeforePeriodCents: 0,
      impededAtPeriodStart: false,
    },
    activities: [
      {
        id: "atividade-1",
        description: "Atividade de teste",
        annexMode: "manual",
        selectedAnnex: annex,
        declaredRevenueCents: currentRevenueCents,
        segments: { [segment]: currentRevenueCents },
      },
    ],
  };
}

function firstPeriodFactorSimulation(
  payrollCents: number | undefined,
  revenueCents = 100_000,
): SimulationInput {
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
        description: "Servico sujeito ao Fator R",
        annexMode: "factor-r",
        declaredRevenueCents: revenueCents,
        segments: { iss_normal: revenueCents },
      },
    ],
  };
}

function midYearSimulation(options: {
  priorYearTailCents: number;
  currentYearBeforeCents: number;
  currentRevenueCents: number;
}): SimulationInput {
  const historyPeriods = [
    "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ];
  const input = manualSimulation({ currentRevenueCents: options.currentRevenueCents });
  input.rulePeriod = "2026-07";
  input.revenueHistory = historyPeriods.map((period, index) => ({
    period,
    internalCents: index === 0
      ? options.priorYearTailCents
      : index === 6
        ? options.currentYearBeforeCents
        : 0,
    externalCents: 0,
  }));
  input.sublimit = {
    priorYearInternalRevenueCents: options.priorYearTailCents,
    priorYearExternalRevenueCents: 0,
    currentYearInternalRevenueBeforePeriodCents: options.currentYearBeforeCents,
    currentYearExternalRevenueBeforePeriodCents: 0,
    impededAtPeriodStart: false,
  };
  return input;
}

function issueCodes(result: ReturnType<typeof simulate>): string[] {
  return result.ok ? [] : result.errors.map(({ code }) => code);
}

describe("funcoes fiscais basicas", () => {
  it("seleciona os limites de faixa em centavos sem aproximacao", () => {
    expect(selectRevenueBand(0)).toBe(1);
    expect(selectRevenueBand(18_000_000)).toBe(1);
    expect(selectRevenueBand(18_000_001)).toBe(2);
    expect(selectRevenueBand(36_000_000)).toBe(2);
    expect(selectRevenueBand(36_000_001)).toBe(3);
    expect(selectRevenueBand(72_000_001)).toBe(4);
    expect(selectRevenueBand(180_000_001)).toBe(5);
    expect(selectRevenueBand(360_000_001)).toBe(6);
    expect(selectRevenueBand(480_000_001)).toBeNull();
  });

  it("usa R$ 1,00 apenas para encontrar a aliquota quando a base e zero", () => {
    expect(calculateEffectiveRate("I", 1, 0)).toBe("0.04");
  });

  it("aplica os casos especiais do Fator R", () => {
    expect(calculateFactorR(0, 0, true)).toBeNull();
    expect(calculateFactorR(0, 0, false)).toBe("0.01");
    expect(calculateFactorR(1, 0, true)).toBe("0.28");
    expect(calculateFactorR(0, 1, true)).toBe("0.01");
    expect(calculateFactorR(28_000, 100_000, true)).toBe("0.28");
  });
});

describe("simulacao", () => {
  it("reproduz o caso de regressao da planilha e fecha o total em centavos", () => {
    const input = manualSimulation({
      rbt12Cents: 152_228_418,
      currentRevenueCents: 45_552_733,
      annex: "I",
    });
    input.activities[0].segments = {
      icms_normal_pis_cofins_normal: 17_936_140,
      icms_st_pis_cofins_normal: 1_852_355,
      icms_st_pis_cofins_monofasico: 25_764_238,
    };

    const result = simulate(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revenueBasis.rateBaseCents).toBe("152228418");
    expect(result.value.activities[0]).toMatchObject({
      annex: "I",
      band: 4,
      nominalRate: "0.107",
      deductionCents: 2_250_000,
      byTaxCents: {
        irpj: 231_047,
        csll: 147_030,
        cofins: 232_491,
        pis: 50_367,
        cpp: 1_764_358,
        icms: 554_111,
        ipi: 0,
        iss: 0,
      },
      totalCents: 2_979_404,
    });
    expect(result.value.totalDasCents).toBe(2_979_404);
    expect(result.value.destinations).toEqual({
      federalCents: 2_425_293,
      stateCents: 554_111,
      municipalCents: 0,
    });
  });

  it("anualiza a receita do proprio PA no primeiro periodo", () => {
    const result = simulate(firstPeriodFactorSimulation(28_000));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revenueBasis).toEqual({
      mode: "first-period-proportionalized",
      monthsOfActivity: 1,
      accumulatedRevenueCents: "100000",
      rateBaseCents: "1200000",
      periods: [],
    });
    expect(result.value.factorR).toBe("0.28");
    expect(result.value.activities[0].annex).toBe("III");
  });

  it("seleciona Anexo V imediatamente abaixo de 28%", () => {
    const result = simulate(firstPeriodFactorSimulation(27_999));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factorR).toBe("0.27999");
    expect(result.value.activities[0].annex).toBe("V");
  });

  it("nao forca enquadramento pelo Fator R no primeiro periodo sem receita", () => {
    const result = simulate(firstPeriodFactorSimulation(0, 0));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factorR).toBeNull();
    expect(result.value.activities[0]).toMatchObject({ annex: null, totalCents: 0 });
    expect(result.value.warnings.map(({ code }) => code))
      .toContain("FACTOR_R_NOT_APPLICABLE_WITHOUT_REVENUE");
  });

  it("exige folha quando existe atividade sujeita ao Fator R", () => {
    expect(issueCodes(simulate(firstPeriodFactorSimulation(undefined)))).toContain("PAYROLL_REQUIRED");
  });

  it("proporcionaliza os meses anteriores e conta mes sem receita no divisor", () => {
    const input = firstPeriodFactorSimulation(0);
    input.rulePeriod = "2026-03";
    input.company.openingDate = "2026-01-10";
    input.revenueHistory = [
      { period: "2026-01", internalCents: 100_000, externalCents: 0 },
      { period: "2026-02", internalCents: 0, externalCents: 0 },
    ];
    input.payroll = {
      history: [
        { period: "2026-01", valueCents: 28_000 },
        { period: "2026-02", valueCents: 0 },
      ],
    };
    input.sublimit.currentYearInternalRevenueBeforePeriodCents = 100_000;

    const result = simulate(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revenueBasis.rateBaseCents).toBe("600000");
    expect(result.value.factorR).toBe("0.28");
  });

  it("bloqueia historico mensal incompleto", () => {
    const input = manualSimulation();
    input.revenueHistory = input.revenueHistory.slice(1);

    expect(issueCodes(simulate(input))).toContain("MISSING_REVENUE_PERIOD");
  });

  it("bloqueia periodo sem conjunto de regras e abertura futura", () => {
    const unsupported = manualSimulation();
    unsupported.rulePeriod = "2027-01";
    expect(issueCodes(simulate(unsupported))).toContain("UNSUPPORTED_PERIOD");

    const futureOpening = manualSimulation();
    futureOpening.company.openingDate = "2026-02-01";
    expect(issueCodes(simulate(futureOpening))).toContain("OPENING_AFTER_PERIOD");
  });

  it("bloqueia CNPJ informado com digitos invalidos", () => {
    const input = manualSimulation();
    input.company.cnpj = "11.111.111/1111-11";

    expect(issueCodes(simulate(input))).toContain("INVALID_CNPJ");
  });

  it("nao calcula enquanto a receita divergir por um centavo", () => {
    const input = manualSimulation();
    input.activities[0].declaredRevenueCents -= 1;
    input.activities[0].segments.icms_normal_pis_cofins_normal = 99_999;

    expect(issueCodes(simulate(input))).toContain("SIMULATION_REVENUE_MISMATCH");
  });

  it("bloqueia qualquer valor monetario negativo", () => {
    const input = manualSimulation();
    input.activities[0].segments.icms_normal_pis_cofins_normal = -1;

    expect(issueCodes(simulate(input))).toContain("INVALID_MONEY");
  });

  it("bloqueia segmento de ISS em atividade do Anexo I", () => {
    const input = manualSimulation();
    input.activities[0].segments = { iss_normal: 100_000 };

    expect(issueCodes(simulate(input))).toContain("INCOMPATIBLE_SEGMENT");
  });

  it("exige confirmacao para substituir a sugestao do Fator R", () => {
    const input = firstPeriodFactorSimulation(28_000);
    input.activities[0].selectedAnnex = "V";
    expect(issueCodes(simulate(input))).toContain("ANNEX_OVERRIDE_CONFIRMATION_REQUIRED");

    input.activities[0].confirmAnnexOverride = true;
    const confirmed = simulate(input);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.activities[0].annex).toBe("V");
    expect(confirmed.value.warnings.map(({ code }) => code)).toContain("ANNEX_OVERRIDE_CONFIRMED");
  });

  it("reconcilia separadamente a receita de exportacao", () => {
    const input = manualSimulation();
    input.currentPeriodRevenue = { internalCents: 80_000, externalCents: 20_000 };
    input.activities[0].segments = {
      icms_normal_pis_cofins_normal: 80_000,
      exportacao: 20_000,
    };

    expect(simulate(input).ok).toBe(true);
    input.currentPeriodRevenue.externalCents = 19_999;
    input.currentPeriodRevenue.internalCents = 80_001;
    expect(issueCodes(simulate(input))).toContain("INTERNAL_REVENUE_MISMATCH");
    expect(issueCodes(simulate(input))).toContain("EXTERNAL_REVENUE_MISMATCH");
  });

  it("aplica teto de 5% ao ISS e redistribui o excedente somente quando devido no DAS", () => {
    const normal = simulate(manualSimulation({
      rbt12Cents: 360_000_000,
      currentRevenueCents: 100_000,
      annex: "III",
      segment: "iss_normal",
    }));
    const retained = simulate(manualSimulation({
      rbt12Cents: 360_000_000,
      currentRevenueCents: 100_000,
      annex: "III",
      segment: "iss_retido",
    }));

    expect(normal.ok).toBe(true);
    expect(retained.ok).toBe(true);
    if (!normal.ok || !retained.ok) return;
    expect(normal.value.activities[0].segments[0].issCapApplied).toBe(true);
    expect(normal.value.activities[0].byTaxCents.iss).toBe(5_000);
    expect(normal.value.activities[0].totalCents).toBe(17_510);
    expect(retained.value.activities[0].segments[0].issCapApplied).toBe(false);
    expect(retained.value.activities[0].byTaxCents.iss).toBe(0);
    expect(normal.value.activities[0].byTaxCents.irpj)
      .toBeGreaterThan(retained.value.activities[0].byTaxCents.irpj);
  });

  it("calcula a faixa 6 com ICMS especial quando o sublimite ainda nao foi excedido", () => {
    const input = midYearSimulation({
      priorYearTailCents: 30_000_000,
      currentYearBeforeCents: 350_000_000,
      currentRevenueCents: 1_000_000,
    });
    const result = simulate(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities[0].band).toBe(6);
    expect(result.value.sublimit.stateTaxMode).toBe("inside-das");
    expect(result.value.activities[0].byTaxCents.icms).toBeGreaterThan(0);
  });

  it("redistribui o ISS acima de 5% na faixa 6 somente quando devido no DAS", () => {
    const normalInput = midYearSimulation({
      priorYearTailCents: 30_000_000,
      currentYearBeforeCents: 350_000_000,
      currentRevenueCents: 1_000_000,
    });
    normalInput.activities[0].selectedAnnex = "III";
    normalInput.activities[0].segments = { iss_normal: 1_000_000 };

    const retainedInput = midYearSimulation({
      priorYearTailCents: 30_000_000,
      currentYearBeforeCents: 350_000_000,
      currentRevenueCents: 1_000_000,
    });
    retainedInput.activities[0].selectedAnnex = "III";
    retainedInput.activities[0].segments = { iss_retido: 1_000_000 };

    const normal = simulate(normalInput);
    const retained = simulate(retainedInput);

    expect(normal.ok).toBe(true);
    expect(retained.ok).toBe(true);
    if (!normal.ok || !retained.ok) return;
    expect(normal.value.activities[0].band).toBe(6);
    expect(normal.value.activities[0].segments[0].issCapApplied).toBe(true);
    expect(normal.value.byTaxCents.iss).toBe(50_000);
    expect(retained.value.byTaxCents.iss).toBe(0);
    expect(normal.value.destinations.federalCents)
      .toBeGreaterThan(retained.value.destinations.federalCents);
  });

  it("aplica a razao do art. 24 no PA que cruza o sublimite", () => {
    const input = midYearSimulation({
      priorYearTailCents: 0,
      currentYearBeforeCents: 350_000_000,
      currentRevenueCents: 20_000_000,
    });
    const result = simulate(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sublimit.stateImpedimentEffect).toBe("next-year");
    expect(result.value.activities[0].segments[0].revenueRatios).toEqual({
      withinSublimit: "0.5",
      betweenSublimitAndLimit: "0.5",
      aboveOverallLimit: "0",
    });
  });

  it("mantem apenas tributos federais quando o impedimento ja produz efeito", () => {
    const input = midYearSimulation({
      priorYearTailCents: 0,
      currentYearBeforeCents: 440_000_001,
      currentRevenueCents: 1_000_000,
    });
    const result = simulate(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sublimit.stateTaxMode).toBe("outside-das");
    expect(result.value.byTaxCents.icms).toBe(0);
    expect(result.value.destinations.stateCents).toBe(0);
    expect(result.value.destinations.federalCents).toBeGreaterThan(0);
  });

  it("entrega memoria de calculo e aviso da politica provisoria de arredondamento", () => {
    const result = simulate(manualSimulation());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.memory.map(({ code }) => code)).toContain("revenue-basis");
    expect(result.value.activities[0].memory.map(({ code }) => code)).toContain("effective-rate");
    expect(result.value.warnings.map(({ code }) => code))
      .toContain("ROUNDING_POLICY_PENDING_PGDAS_VALIDATION");
  });
});
