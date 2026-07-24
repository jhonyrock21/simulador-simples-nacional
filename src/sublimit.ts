import Decimal from "decimal.js-light";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Market = "internal" | "external";
export type FiscalEffect =
  | "none"
  | "next-year"
  | "next-period"
  | "retroactive-opening"
  | "already-effective";

export interface SublimitEvaluationInput {
  periodYear: number;
  openingYear: number;
  openingMonth: number;
  priorYearInternalRevenueCents: number;
  priorYearExternalRevenueCents: number;
  currentYearInternalRevenueBeforePeriodCents: number;
  currentYearExternalRevenueBeforePeriodCents: number;
  currentPeriodInternalRevenueCents: number;
  currentPeriodExternalRevenueCents: number;
  impededAtPeriodStart: boolean;
}

export interface SublimitIssue {
  code: string;
  path: string;
  message: string;
}

export interface MarketRevenueSplit {
  market: Market;
  revenueBeforePeriodCents: number;
  currentPeriodRevenueCents: number;
  revenueThroughPeriodCents: number;
  withinSublimitRatio: string;
  betweenSublimitAndLimitRatio: string;
  aboveOverallLimitRatio: string;
}

export interface SublimitEvaluation {
  startupYear: boolean;
  sublimitCents: number;
  overallLimitCents: number;
  twentyPercentSublimitCents: number;
  twentyPercentOverallLimitCents: number;
  stateTaxMode: "inside-das" | "outside-das";
  stateImpedimentEffect: FiscalEffect;
  simplifiedRegimeExclusionEffect: Exclude<FiscalEffect, "already-effective">;
  markets: Readonly<Record<Market, MarketRevenueSplit>>;
  warnings: readonly SublimitIssue[];
}

export type SublimitEvaluationResult =
  | { ok: true; value: SublimitEvaluation }
  | { ok: false; errors: readonly SublimitIssue[] };

function isNonNegativeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function ratioText(numerator: number, denominator: number): string {
  if (denominator === 0) return numerator === 0 ? "0" : "1";
  return new Decimal(numerator).div(denominator).toSignificantDigits(30).toString();
}

function splitMarket(
  market: Market,
  revenueBeforePeriodCents: number,
  currentPeriodRevenueCents: number,
  sublimitCents: number,
  overallLimitCents: number,
): MarketRevenueSplit {
  const revenueThroughPeriodCents = revenueBeforePeriodCents + currentPeriodRevenueCents;
  const aboveSublimitCents = Math.min(
    currentPeriodRevenueCents,
    Math.max(0, revenueThroughPeriodCents - sublimitCents),
  );
  const aboveOverallLimitCents = Math.min(
    currentPeriodRevenueCents,
    Math.max(0, revenueThroughPeriodCents - overallLimitCents),
  );
  const betweenCents = aboveSublimitCents - aboveOverallLimitCents;
  const withinCents = currentPeriodRevenueCents - aboveSublimitCents;

  return {
    market,
    revenueBeforePeriodCents,
    currentPeriodRevenueCents,
    revenueThroughPeriodCents,
    withinSublimitRatio: ratioText(withinCents, currentPeriodRevenueCents),
    betweenSublimitAndLimitRatio: ratioText(betweenCents, currentPeriodRevenueCents),
    aboveOverallLimitRatio: ratioText(aboveOverallLimitCents, currentPeriodRevenueCents),
  };
}

export function evaluateSublimit(
  input: SublimitEvaluationInput,
): SublimitEvaluationResult {
  const errors: SublimitIssue[] = [];
  const warnings: SublimitIssue[] = [];
  const moneyFields: Array<[keyof SublimitEvaluationInput, unknown]> = [
    ["priorYearInternalRevenueCents", input.priorYearInternalRevenueCents],
    ["priorYearExternalRevenueCents", input.priorYearExternalRevenueCents],
    ["currentYearInternalRevenueBeforePeriodCents", input.currentYearInternalRevenueBeforePeriodCents],
    ["currentYearExternalRevenueBeforePeriodCents", input.currentYearExternalRevenueBeforePeriodCents],
    ["currentPeriodInternalRevenueCents", input.currentPeriodInternalRevenueCents],
    ["currentPeriodExternalRevenueCents", input.currentPeriodExternalRevenueCents],
  ];

  for (const [field, value] of moneyFields) {
    if (!isNonNegativeCents(value)) {
      errors.push({
        code: "INVALID_MONEY",
        path: field,
        message: "Valor deve ser um inteiro não negativo em centavos.",
      });
    }
  }
  if (!Number.isInteger(input.openingMonth) || input.openingMonth < 1 || input.openingMonth > 12) {
    errors.push({ code: "INVALID_OPENING_MONTH", path: "openingMonth", message: "Mês de abertura inválido." });
  }
  if (input.openingYear > input.periodYear) {
    errors.push({ code: "OPENING_AFTER_PERIOD", path: "openingYear", message: "Ano de abertura posterior ao PA." });
  }
  if (errors.length > 0) return { ok: false, errors };

  const startupYear = input.openingYear === input.periodYear;
  const monthsFromOpeningThroughYearEnd = 13 - input.openingMonth;
  const sublimitCents = startupYear
    ? 30_000_000 * monthsFromOpeningThroughYearEnd
    : 360_000_000;
  const overallLimitCents = startupYear
    ? 40_000_000 * monthsFromOpeningThroughYearEnd
    : 480_000_000;
  const twentyPercentSublimitCents = sublimitCents * 1.2;
  const twentyPercentOverallLimitCents = overallLimitCents * 1.2;

  if (
    !Number.isSafeInteger(input.currentYearInternalRevenueBeforePeriodCents + input.currentPeriodInternalRevenueCents)
    || !Number.isSafeInteger(input.currentYearExternalRevenueBeforePeriodCents + input.currentPeriodExternalRevenueCents)
  ) {
    return {
      ok: false,
      errors: [{ code: "MONEY_OVERFLOW", path: "currentPeriodRevenue", message: "Soma monetária excede o limite seguro." }],
    };
  }

  if (
    startupYear
    && (input.priorYearInternalRevenueCents !== 0 || input.priorYearExternalRevenueCents !== 0)
  ) {
    errors.push({
      code: "PRIOR_YEAR_REVENUE_NOT_ALLOWED_IN_STARTUP",
      path: "priorYearRevenue",
      message: "Empresa no ano de abertura não pode informar receita do ano anterior.",
    });
  }

  const priorYearExceededOverall = !startupYear && (
    input.priorYearInternalRevenueCents > overallLimitCents
    || input.priorYearExternalRevenueCents > overallLimitCents
  );
  if (priorYearExceededOverall) {
    errors.push({
      code: "PRIOR_YEAR_LIMIT_EXCEEDED",
      path: "priorYearRevenue",
      message: "Receita do ano anterior supera o limite e impede a simulação no Simples Nacional.",
    });
  }

  const beforeExceededOverallByMoreThanTwenty =
    input.currentYearInternalRevenueBeforePeriodCents > twentyPercentOverallLimitCents
    || input.currentYearExternalRevenueBeforePeriodCents > twentyPercentOverallLimitCents;
  if (beforeExceededOverallByMoreThanTwenty) {
    errors.push({
      code: startupYear
        ? "STARTUP_LIMIT_EXCLUSION_RETROACTIVE"
        : "SIMPLIFIED_REGIME_EXCLUSION_ALREADY_EFFECTIVE",
      path: "currentYearRevenueBeforePeriod",
      message: startupYear
        ? "Excesso superior a 20% no ano de abertura exclui retroativamente a empresa do Simples Nacional."
        : "O excesso superior a 20% em período anterior já produz exclusão neste PA.",
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const markets = {
    internal: splitMarket(
      "internal",
      input.currentYearInternalRevenueBeforePeriodCents,
      input.currentPeriodInternalRevenueCents,
      sublimitCents,
      overallLimitCents,
    ),
    external: splitMarket(
      "external",
      input.currentYearExternalRevenueBeforePeriodCents,
      input.currentPeriodExternalRevenueCents,
      sublimitCents,
      overallLimitCents,
    ),
  } as const;

  const priorYearExceededSublimit = !startupYear && (
    input.priorYearInternalRevenueCents > sublimitCents
    || input.priorYearExternalRevenueCents > sublimitCents
  );
  const beforeExceededSublimitByMoreThanTwenty =
    input.currentYearInternalRevenueBeforePeriodCents > twentyPercentSublimitCents
    || input.currentYearExternalRevenueBeforePeriodCents > twentyPercentSublimitCents;
  const stateOutsideAtStart = input.impededAtPeriodStart
    || priorYearExceededSublimit
    || beforeExceededSublimitByMoreThanTwenty;

  const throughExceededSublimit =
    markets.internal.revenueThroughPeriodCents > sublimitCents
    || markets.external.revenueThroughPeriodCents > sublimitCents;
  const throughExceededSublimitByMoreThanTwenty =
    markets.internal.revenueThroughPeriodCents > twentyPercentSublimitCents
    || markets.external.revenueThroughPeriodCents > twentyPercentSublimitCents;
  const throughExceededOverall =
    markets.internal.revenueThroughPeriodCents > overallLimitCents
    || markets.external.revenueThroughPeriodCents > overallLimitCents;
  const throughExceededOverallByMoreThanTwenty =
    markets.internal.revenueThroughPeriodCents > twentyPercentOverallLimitCents
    || markets.external.revenueThroughPeriodCents > twentyPercentOverallLimitCents;

  if (startupYear && throughExceededOverallByMoreThanTwenty) {
    return {
      ok: false,
      errors: [{
        code: "STARTUP_LIMIT_EXCLUSION_RETROACTIVE",
        path: "currentPeriodRevenue",
        message: "Excesso superior a 20% do limite proporcional exclui retroativamente a empresa do Simples Nacional.",
      }],
    };
  }

  let stateImpedimentEffect: FiscalEffect = "none";
  if (stateOutsideAtStart) stateImpedimentEffect = "already-effective";
  else if (startupYear && throughExceededSublimitByMoreThanTwenty) {
    stateImpedimentEffect = "retroactive-opening";
  } else if (throughExceededSublimitByMoreThanTwenty) {
    stateImpedimentEffect = "next-period";
  } else if (throughExceededSublimit) {
    stateImpedimentEffect = "next-year";
  }

  let simplifiedRegimeExclusionEffect: SublimitEvaluation["simplifiedRegimeExclusionEffect"] = "none";
  if (throughExceededOverallByMoreThanTwenty) simplifiedRegimeExclusionEffect = "next-period";
  else if (throughExceededOverall) simplifiedRegimeExclusionEffect = "next-year";

  const stateTaxMode = stateOutsideAtStart
    || (startupYear && throughExceededSublimitByMoreThanTwenty)
    ? "outside-das"
    : "inside-das";

  if (stateTaxMode === "outside-das") {
    warnings.push({
      code: "STATE_TAX_OUTSIDE_DAS",
      path: "sublimit",
      message: "ICMS e ISS não integram o DAS neste período.",
    });
  } else if (stateImpedimentEffect === "next-period") {
    warnings.push({
      code: "STATE_IMPEDIMENT_NEXT_PERIOD",
      path: "sublimit",
      message: "ICMS e ISS deixarão o DAS no período seguinte.",
    });
  } else if (stateImpedimentEffect === "next-year") {
    warnings.push({
      code: "STATE_IMPEDIMENT_NEXT_YEAR",
      path: "sublimit",
      message: "ICMS e ISS deixarão o DAS no ano seguinte, salvo nova regra aplicável.",
    });
  }

  if (simplifiedRegimeExclusionEffect !== "none") {
    warnings.push({
      code: simplifiedRegimeExclusionEffect === "next-period"
        ? "SIMPLIFIED_REGIME_EXCLUSION_NEXT_PERIOD"
        : "SIMPLIFIED_REGIME_EXCLUSION_NEXT_YEAR",
      path: "sublimit",
      message: simplifiedRegimeExclusionEffect === "next-period"
        ? "A exclusão do Simples Nacional produz efeitos no período seguinte."
        : "A exclusão do Simples Nacional produz efeitos no ano seguinte.",
    });
  }

  return {
    ok: true,
    value: {
      startupYear,
      sublimitCents,
      overallLimitCents,
      twentyPercentSublimitCents,
      twentyPercentOverallLimitCents,
      stateTaxMode,
      stateImpedimentEffect,
      simplifiedRegimeExclusionEffect,
      markets,
      warnings,
    },
  };
}
