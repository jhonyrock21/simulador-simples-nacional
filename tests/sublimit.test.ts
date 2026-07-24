import { describe, expect, it } from "vitest";

import {
  evaluateSublimit,
  type SublimitEvaluationInput,
} from "../src/sublimit";

function establishedInput(overrides: Partial<SublimitEvaluationInput> = {}): SublimitEvaluationInput {
  return {
    periodYear: 2026,
    openingYear: 2020,
    openingMonth: 1,
    priorYearInternalRevenueCents: 0,
    priorYearExternalRevenueCents: 0,
    currentYearInternalRevenueBeforePeriodCents: 0,
    currentYearExternalRevenueBeforePeriodCents: 0,
    currentPeriodInternalRevenueCents: 0,
    currentPeriodExternalRevenueCents: 0,
    impededAtPeriodStart: false,
    ...overrides,
  };
}

function codes(result: ReturnType<typeof evaluateSublimit>): string[] {
  return result.ok ? [] : result.errors.map(({ code }) => code);
}

describe("avaliacao do sublimite de 2026", () => {
  it("usa os limites anuais de R$ 3,6 milhoes e R$ 4,8 milhoes", () => {
    const result = evaluateSublimit(establishedInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      startupYear: false,
      sublimitCents: 360_000_000,
      overallLimitCents: 480_000_000,
      twentyPercentSublimitCents: 432_000_000,
      twentyPercentOverallLimitCents: 576_000_000,
      stateTaxMode: "inside-das",
    });
  });

  it("divide o PA entre a parcela anterior e posterior ao sublimite", () => {
    const result = evaluateSublimit(establishedInput({
      currentYearInternalRevenueBeforePeriodCents: 350_000_000,
      currentPeriodInternalRevenueCents: 20_000_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.markets.internal).toMatchObject({
      withinSublimitRatio: "0.5",
      betweenSublimitAndLimitRatio: "0.5",
      aboveOverallLimitRatio: "0",
    });
    expect(result.value.stateImpedimentEffect).toBe("next-year");
  });

  it("separa tambem a parcela acima do limite geral", () => {
    const result = evaluateSublimit(establishedInput({
      currentYearInternalRevenueBeforePeriodCents: 470_000_000,
      currentPeriodInternalRevenueCents: 20_000_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.markets.internal).toMatchObject({
      withinSublimitRatio: "0",
      betweenSublimitAndLimitRatio: "0.5",
      aboveOverallLimitRatio: "0.5",
    });
    expect(result.value.simplifiedRegimeExclusionEffect).toBe("next-year");
  });

  it("mantem o PA do excesso superior a 20% e impede ICMS/ISS no PA seguinte", () => {
    const crossing = evaluateSublimit(establishedInput({
      currentYearInternalRevenueBeforePeriodCents: 430_000_000,
      currentPeriodInternalRevenueCents: 10_000_001,
    }));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    expect(crossing.value.stateTaxMode).toBe("inside-das");
    expect(crossing.value.stateImpedimentEffect).toBe("next-period");

    const following = evaluateSublimit(establishedInput({
      currentYearInternalRevenueBeforePeriodCents: 440_000_001,
      currentPeriodInternalRevenueCents: 1,
    }));
    expect(following.ok).toBe(true);
    if (!following.ok) return;
    expect(following.value.stateTaxMode).toBe("outside-das");
    expect(following.value.stateImpedimentEffect).toBe("already-effective");
  });

  it("considera separadamente a exportacao para disparar o impedimento", () => {
    const result = evaluateSublimit(establishedInput({
      priorYearInternalRevenueCents: 200_000_000,
      priorYearExternalRevenueCents: 400_000_000,
      currentPeriodInternalRevenueCents: 100_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stateTaxMode).toBe("outside-das");
    expect(result.value.warnings.map(({ code }) => code)).toContain("STATE_TAX_OUTSIDE_DAS");
  });

  it("bloqueia empresa que ja deveria estar excluida do Simples", () => {
    expect(codes(evaluateSublimit(establishedInput({
      priorYearInternalRevenueCents: 480_000_001,
    })))).toContain("PRIOR_YEAR_LIMIT_EXCEEDED");

    expect(codes(evaluateSublimit(establishedInput({
      currentYearInternalRevenueBeforePeriodCents: 576_000_001,
    })))).toContain("SIMPLIFIED_REGIME_EXCLUSION_ALREADY_EFFECTIVE");
  });

  it("proporcionaliza os dois limites no ano de abertura", () => {
    const result = evaluateSublimit(establishedInput({
      openingYear: 2026,
      openingMonth: 9,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      startupYear: true,
      sublimitCents: 120_000_000,
      overallLimitCents: 160_000_000,
      twentyPercentSublimitCents: 144_000_000,
      twentyPercentOverallLimitCents: 192_000_000,
    });
  });

  it("aplica efeito retroativo ao ICMS/ISS no excesso superior a 20% do ano de abertura", () => {
    const result = evaluateSublimit(establishedInput({
      openingYear: 2026,
      openingMonth: 9,
      currentYearInternalRevenueBeforePeriodCents: 100_000_000,
      currentPeriodInternalRevenueCents: 50_000_000,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stateTaxMode).toBe("outside-das");
    expect(result.value.stateImpedimentEffect).toBe("retroactive-opening");
  });

  it("bloqueia exclusao retroativa do Simples no excesso geral do ano de abertura", () => {
    const result = evaluateSublimit(establishedInput({
      openingYear: 2026,
      openingMonth: 9,
      currentYearInternalRevenueBeforePeriodCents: 150_000_000,
      currentPeriodInternalRevenueCents: 42_000_001,
    }));

    expect(codes(result)).toContain("STARTUP_LIMIT_EXCLUSION_RETROACTIVE");
  });

  it("mantem razoes neutras quando nao ha receita no PA", () => {
    const result = evaluateSublimit(establishedInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.markets.internal).toMatchObject({
      withinSublimitRatio: "0",
      betweenSublimitAndLimitRatio: "0",
      aboveOverallLimitRatio: "0",
    });
  });
});
