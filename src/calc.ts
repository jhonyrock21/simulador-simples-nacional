import Decimal from "decimal.js-light";

import {
  ANNEXES,
  ANNEX_RULES_2026,
  ISS_EXCESS_REDISTRIBUTION_2026,
  REVENUE_BANDS_2026,
  REVENUE_SEGMENTS_2026,
  RULESET_2026,
  TAXES,
  type Annex,
  type Band,
  type Tax,
} from "./rules-2026";
import {
  evaluateSublimit,
  type MarketRevenueSplit,
  type SublimitEvaluation,
} from "./sublimit";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type RevenueSegmentCode = (typeof REVENUE_SEGMENTS_2026)[number]["code"];
export type MoneyByTax = Readonly<Record<Tax, number>>;
type DecimalValue = string | number | Decimal;

export interface MonthlyRevenueInput {
  period: string;
  internalCents: number;
  externalCents: number;
}

export interface MonthlyPayrollInput {
  period: string;
  valueCents: number;
}

export interface ActivityInput {
  id: string;
  description: string;
  annexMode: "manual" | "factor-r";
  selectedAnnex?: Annex;
  confirmAnnexOverride?: boolean;
  declaredRevenueCents: number;
  segments: Partial<Record<RevenueSegmentCode, number>>;
}

export interface SublimitInput {
  priorYearInternalRevenueCents: number;
  priorYearExternalRevenueCents: number;
  currentYearInternalRevenueBeforePeriodCents: number;
  currentYearExternalRevenueBeforePeriodCents: number;
  impededAtPeriodStart: boolean;
}

export interface SimulationInput {
  rulePeriod: string;
  company: {
    name?: string;
    cnpj?: string;
    openingDate: string;
  };
  revenueHistory: MonthlyRevenueInput[];
  currentPeriodRevenue: {
    internalCents: number;
    externalCents: number;
  };
  payroll: {
    currentPeriodCents?: number;
    history?: MonthlyPayrollInput[];
  };
  sublimit: SublimitInput;
  activities: ActivityInput[];
}

export interface SimulationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CalculationMemoryStep {
  readonly code: string;
  readonly label: string;
  readonly formula: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly result: string;
}

export interface SegmentResult {
  readonly code: RevenueSegmentCode;
  readonly revenueCents: number;
  readonly rawTaxCents: Readonly<Record<Tax, string>>;
  readonly issCapApplied: boolean;
  readonly revenueRatios: {
    readonly withinSublimit: string;
    readonly betweenSublimitAndLimit: string;
    readonly aboveOverallLimit: string;
  };
}

export interface ActivityResult {
  readonly id: string;
  readonly description: string;
  readonly annex: Annex | null;
  readonly annexSuggestedByFactorR: Annex | null;
  readonly band: Band;
  readonly nominalRate: string | null;
  readonly deductionCents: number | null;
  readonly effectiveRate: string | null;
  readonly revenueCents: number;
  readonly segments: readonly SegmentResult[];
  readonly byTaxCents: MoneyByTax;
  readonly totalCents: number;
  readonly rawTotalCents: string;
  readonly memory: readonly CalculationMemoryStep[];
}

export interface SimulationValue {
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly period: string;
  readonly monthsBeforePeriod: number;
  readonly revenueBasis: {
    readonly mode: "first-period-proportionalized" | "startup-proportionalized" | "rbt12";
    readonly monthsOfActivity: number;
    readonly accumulatedRevenueCents: string;
    readonly rateBaseCents: string;
    readonly periods: readonly string[];
  };
  readonly factorR: string | null;
  readonly sublimit: SublimitEvaluation;
  readonly activities: readonly ActivityResult[];
  readonly byTaxCents: MoneyByTax;
  readonly totalDasCents: number;
  readonly destinations: {
    readonly federalCents: number;
    readonly stateCents: number;
    readonly municipalCents: number;
  };
  readonly warnings: readonly SimulationIssue[];
  readonly memory: readonly CalculationMemoryStep[];
}

export type SimulationResult =
  | { readonly ok: true; readonly value: SimulationValue }
  | { readonly ok: false; readonly errors: readonly SimulationIssue[] };

const SEGMENTS_BY_CODE = new Map(
  REVENUE_SEGMENTS_2026.map((segment) => [segment.code, segment] as const),
);

const PRODUCT_SEGMENTS = new Set<RevenueSegmentCode>([
  "icms_normal_pis_cofins_normal",
  "icms_normal_pis_cofins_monofasico",
  "icms_st_pis_cofins_normal",
  "icms_st_pis_cofins_monofasico",
  "icms_isento_pis_cofins_normal",
  "icms_isento_pis_cofins_monofasico",
  "exportacao",
]);

const SERVICE_SEGMENTS = new Set<RevenueSegmentCode>([
  "iss_normal",
  "iss_isento_imune",
  "iss_retido",
  "exportacao",
]);

function emptyDecimalTaxes(): Record<Tax, Decimal> {
  return {
    irpj: new Decimal(0),
    csll: new Decimal(0),
    cofins: new Decimal(0),
    pis: new Decimal(0),
    cpp: new Decimal(0),
    icms: new Decimal(0),
    ipi: new Decimal(0),
    iss: new Decimal(0),
  };
}

function emptyMoneyTaxes(): Record<Tax, number> {
  return { irpj: 0, csll: 0, cofins: 0, pis: 0, cpp: 0, icms: 0, ipi: 0, iss: 0 };
}

function decimalText(value: Decimal): string {
  return value.toSignificantDigits(30).toString();
}

function isNonNegativeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function addIssue(
  issues: SimulationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function parsePeriod(period: string): { year: number; month: number; index: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year, month, index: year * 12 + month - 1 };
}

function parseDate(value: string): { year: number; month: number; day: number; monthIndex: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, monthIndex: year * 12 + month - 1 };
}

function periodFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function requiredHistoryPeriods(periodIndex: number, monthsBeforePeriod: number): string[] {
  const count = Math.min(monthsBeforePeriod, 12);
  return Array.from({ length: count }, (_, offset) =>
    periodFromIndex(periodIndex - count + offset),
  );
}

export interface HistoryPlan {
  readonly monthsBeforePeriod: number;
  readonly periods: readonly string[];
  readonly periodYear: number;
  readonly startupYear: boolean;
}

export type HistoryPlanResult =
  | { readonly ok: true; readonly value: HistoryPlan }
  | { readonly ok: false; readonly error: string };

/**
 * Informa quais competencias mensais o motor exigira para uma dada abertura e
 * competencia. A interface usa isto apenas para montar os campos de coleta; o
 * calculo continua sendo responsabilidade exclusiva de `simulate`.
 */
export function planHistory(rulePeriod: string, openingDate: string): HistoryPlanResult {
  const period = parsePeriod(rulePeriod);
  if (!period) return { ok: false, error: "Competência deve usar o formato AAAA-MM." };

  const opening = parseDate(openingDate);
  if (!opening) return { ok: false, error: "Data de abertura inválida; use AAAA-MM-DD." };

  const monthsBeforePeriod = period.index - opening.monthIndex;
  if (monthsBeforePeriod < 0) {
    return { ok: false, error: "A abertura não pode ser posterior à competência." };
  }

  return {
    ok: true,
    value: {
      monthsBeforePeriod,
      periods: requiredHistoryPeriods(period.index, monthsBeforePeriod),
      periodYear: period.year,
      startupYear: opening.year === period.year,
    },
  };
}

function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;

  const calculateDigit = (length: number): number => {
    let sum = 0;
    let weight = length - 7;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return calculateDigit(12) === Number(digits[12])
    && calculateDigit(13) === Number(digits[13]);
}

function indexMonthlyRevenue(
  history: readonly MonthlyRevenueInput[],
  issues: SimulationIssue[],
): Map<string, MonthlyRevenueInput> {
  const indexed = new Map<string, MonthlyRevenueInput>();

  history.forEach((entry, index) => {
    const path = `revenueHistory[${index}]`;
    if (!parsePeriod(entry.period)) {
      addIssue(issues, "INVALID_PERIOD", `${path}.period`, "Competência mensal inválida.");
      return;
    }
    if (indexed.has(entry.period)) {
      addIssue(issues, "DUPLICATE_PERIOD", `${path}.period`, "Competência repetida no histórico de receita.");
      return;
    }
    if (!isNonNegativeCents(entry.internalCents)) {
      addIssue(issues, "INVALID_MONEY", `${path}.internalCents`, "Receita interna deve ser um inteiro não negativo em centavos.");
    }
    if (!isNonNegativeCents(entry.externalCents)) {
      addIssue(issues, "INVALID_MONEY", `${path}.externalCents`, "Receita externa deve ser um inteiro não negativo em centavos.");
    }
    indexed.set(entry.period, entry);
  });

  return indexed;
}

function indexMonthlyPayroll(
  history: readonly MonthlyPayrollInput[],
  issues: SimulationIssue[],
): Map<string, MonthlyPayrollInput> {
  const indexed = new Map<string, MonthlyPayrollInput>();

  history.forEach((entry, index) => {
    const path = `payroll.history[${index}]`;
    if (!parsePeriod(entry.period)) {
      addIssue(issues, "INVALID_PERIOD", `${path}.period`, "Competência mensal inválida.");
      return;
    }
    if (indexed.has(entry.period)) {
      addIssue(issues, "DUPLICATE_PERIOD", `${path}.period`, "Competência repetida no histórico de folha.");
      return;
    }
    if (!isNonNegativeCents(entry.valueCents)) {
      addIssue(issues, "INVALID_MONEY", `${path}.valueCents`, "Folha deve ser um inteiro nao negativo em centavos.");
    }
    indexed.set(entry.period, entry);
  });

  return indexed;
}

export function selectRevenueBand(rateBaseCents: DecimalValue): Band | null {
  const base = new Decimal(rateBaseCents);
  if (base.isNegative()) return null;

  const band = REVENUE_BANDS_2026.find(({ upperInclusiveCents }) =>
    base.lte(upperInclusiveCents),
  );
  return band?.band ?? null;
}

export function calculateFactorR(
  payrollCents: DecimalValue,
  revenueCents: DecimalValue,
  firstPeriod: boolean,
): string | null {
  const payroll = new Decimal(payrollCents);
  const revenue = new Decimal(revenueCents);

  if (firstPeriod && payroll.isZero() && revenue.isZero()) return null;
  if (payroll.isZero()) return "0.01";
  if (revenue.isZero()) return "0.28";
  return decimalText(payroll.div(revenue));
}

export function calculateEffectiveRate(
  annex: Annex,
  band: Band,
  rateBaseCents: DecimalValue,
): string {
  const rule = ANNEX_RULES_2026.find((candidate) =>
    candidate.annex === annex && candidate.band === band,
  );
  if (!rule) throw new Error(`Regra ausente para ${annex}-${band}.`);

  const rateBase = new Decimal(rateBaseCents);
  const baseForRate = rateBase.isZero() ? new Decimal(100) : rateBase;
  return decimalText(
    baseForRate.mul(rule.nominalRate).minus(rule.deductionCents).div(baseForRate),
  );
}

function ratesForSegment(
  annex: Annex,
  baseRates: Readonly<Record<Tax, Decimal>>,
  issInsideDas: boolean,
): { rates: Record<Tax, Decimal>; issCapApplied: boolean } {
  const rates = emptyDecimalTaxes();
  for (const tax of TAXES) rates[tax] = baseRates[tax];

  if (!issInsideDas || rates.iss.lte(RULESET_2026.issRateCap)) {
    return { rates, issCapApplied: false };
  }

  if (annex !== "III" && annex !== "IV" && annex !== "V") {
    throw new Error(`Redistribuicao do ISS ausente para o Anexo ${annex}.`);
  }

  const excess = rates.iss.minus(RULESET_2026.issRateCap);
  rates.iss = new Decimal(RULESET_2026.issRateCap);
  redistributeIssExcess(annex, rates, excess);

  return { rates, issCapApplied: true };
}

function redistributeIssExcess(
  annex: Annex,
  rates: Record<Tax, Decimal>,
  excess: Decimal,
): void {
  if (annex !== "III" && annex !== "IV" && annex !== "V") {
    throw new Error(`Redistribuicao do ISS ausente para o Anexo ${annex}.`);
  }

  const weights = ISS_EXCESS_REDISTRIBUTION_2026[annex];

  rates.irpj = rates.irpj.plus(excess.mul(weights.irpj));
  rates.csll = rates.csll.plus(excess.mul(weights.csll));
  rates.cofins = rates.cofins.plus(excess.mul(weights.cofins));
  rates.pis = rates.pis.plus(excess.mul(weights.pis));
  rates.cpp = rates.cpp.plus(excess.mul(weights.cpp));
}

function copyRates(source: Readonly<Record<Tax, Decimal>>): Record<Tax, Decimal> {
  const copy = emptyDecimalTaxes();
  for (const tax of TAXES) copy[tax] = source[tax];
  return copy;
}

function specialStateRates(
  annex: Annex,
  denominatorCents: Decimal,
): { icms: Decimal; iss: Decimal; issExcess: Decimal; issCapApplied: boolean } {
  const fifthBandRule = ANNEX_RULES_2026.find((candidate) =>
    candidate.annex === annex && candidate.band === 5,
  );
  if (!fifthBandRule) throw new Error(`Regra da faixa 5 ausente para o Anexo ${annex}.`);

  const effective = denominatorCents.mul(fifthBandRule.nominalRate)
    .minus(fifthBandRule.deductionCents)
    .div(denominatorCents);
  const rawIss = effective.mul(fifthBandRule.shares.iss);
  const issCap = new Decimal(RULESET_2026.issRateCap);
  const issExcess = rawIss.gt(issCap) ? rawIss.minus(issCap) : new Decimal(0);

  return {
    icms: effective.mul(fifthBandRule.shares.icms),
    iss: rawIss.gt(issCap) ? issCap : rawIss,
    issExcess,
    issCapApplied: rawIss.gt(RULESET_2026.issRateCap),
  };
}

function maximumFederalRates(annex: Annex): Record<Tax, Decimal> {
  const sixthBandRule = ANNEX_RULES_2026.find((candidate) =>
    candidate.annex === annex && candidate.band === 6,
  );
  if (!sixthBandRule) throw new Error(`Regra da faixa 6 ausente para o Anexo ${annex}.`);

  const maximumBase = new Decimal(RULESET_2026.maximumGrossRevenueCents);
  const effective = maximumBase.mul(sixthBandRule.nominalRate)
    .minus(sixthBandRule.deductionCents)
    .div(maximumBase);
  const rates = emptyDecimalTaxes();
  for (const tax of ["irpj", "csll", "cofins", "pis", "cpp", "ipi"] as const) {
    rates[tax] = effective.mul(sixthBandRule.shares[tax]);
  }
  return rates;
}

function blendedRatesForSegment(
  annex: Annex,
  band: Band,
  rateBase: Decimal,
  baseRates: Readonly<Record<Tax, Decimal>>,
  split: MarketRevenueSplit,
  stateTaxMode: SublimitEvaluation["stateTaxMode"],
  issInsideDas: boolean,
): { rates: Record<Tax, Decimal>; issCapApplied: boolean } {
  const issSubjectToCap = issInsideDas && stateTaxMode === "inside-das";
  const standardAdjusted = ratesForSegment(annex, baseRates, issSubjectToCap);
  const standard = copyRates(standardAdjusted.rates);
  const between = copyRates(standardAdjusted.rates);
  const above = maximumFederalRates(annex);
  // O teto do ISS no tier "standard" vale para a parcela dentro do sublimite; o
  // tier "special" (faixa 5 fixa) vale apenas para as parcelas entre sublimite e
  // limite. Cada flag so pode ser reportada quando o tier correspondente carrega
  // receita, senao a memoria de calculo anunciaria um teto que nao afetou nada.
  let standardIssCapApplied = standardAdjusted.issCapApplied;
  let specialIssCapApplied = false;

  if (stateTaxMode === "outside-das") {
    for (const rates of [standard, between, above]) {
      rates.icms = new Decimal(0);
      rates.iss = new Decimal(0);
    }
  } else {
    const fixedState = specialStateRates(
      annex,
      new Decimal(RULESET_2026.stateAndMunicipalSublimitCents),
    );
    between.icms = fixedState.icms;
    between.iss = fixedState.iss;
    above.icms = fixedState.icms;
    above.iss = fixedState.iss;
    specialIssCapApplied = fixedState.issCapApplied;

    if (band === 6) {
      const sixthBandState = specialStateRates(annex, rateBase);
      standard.icms = sixthBandState.icms;
      standard.iss = sixthBandState.iss;
      if (issSubjectToCap && sixthBandState.issCapApplied) {
        redistributeIssExcess(annex, standard, sixthBandState.issExcess);
      }
      standardIssCapApplied ||= sixthBandState.issCapApplied;
    }
  }

  const withinRatio = new Decimal(split.withinSublimitRatio);
  const betweenRatio = new Decimal(split.betweenSublimitAndLimitRatio);
  const aboveRatio = new Decimal(split.aboveOverallLimitRatio);
  const blended = emptyDecimalTaxes();
  for (const tax of TAXES) {
    blended[tax] = standard[tax].mul(withinRatio)
      .plus(between[tax].mul(betweenRatio))
      .plus(above[tax].mul(aboveRatio));
  }

  const specialTierCarriesRevenue = betweenRatio.gt(0) || aboveRatio.gt(0);
  const issCapApplied = issSubjectToCap && (
    (withinRatio.gt(0) && standardIssCapApplied)
    || (specialTierCarriesRevenue && specialIssCapApplied)
  );

  return { rates: blended, issCapApplied };
}

function roundAndReconcile(rawTaxes: Readonly<Record<Tax, Decimal>>): {
  byTaxCents: Record<Tax, number>;
  totalCents: number;
  rawTotal: Decimal;
} {
  const rawTotal = TAXES.reduce((sum, tax) => sum.plus(rawTaxes[tax]), new Decimal(0));
  const totalCents = rawTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const rounded = emptyMoneyTaxes();

  for (const tax of TAXES) {
    rounded[tax] = rawTaxes[tax].toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }

  const roundedTotal = TAXES.reduce((sum, tax) => sum + rounded[tax], 0);
  const difference = totalCents - roundedTotal;

  if (difference !== 0) {
    const targetTax = TAXES.reduce((largest, tax) =>
      rawTaxes[tax].gt(rawTaxes[largest]) ? tax : largest,
    );
    rounded[targetTax] += difference;
  }

  return { byTaxCents: rounded, totalCents, rawTotal };
}

export function simulate(input: SimulationInput): SimulationResult {
  const errors: SimulationIssue[] = [];
  const warnings: SimulationIssue[] = [];
  const memory: CalculationMemoryStep[] = [];
  const period = parsePeriod(input.rulePeriod);
  const opening = parseDate(input.company.openingDate);

  if (!period) {
    addIssue(errors, "INVALID_PERIOD", "rulePeriod", "Competência deve usar o formato AAAA-MM.");
  } else if (input.rulePeriod < RULESET_2026.period.from || input.rulePeriod > RULESET_2026.period.through) {
    addIssue(errors, "UNSUPPORTED_PERIOD", "rulePeriod", "Somente competências de 2026 possuem regras homologáveis neste conjunto.");
  }
  if (!opening) {
    addIssue(errors, "INVALID_OPENING_DATE", "company.openingDate", "Data de abertura inválida; use AAAA-MM-DD.");
  }
  if (input.company.cnpj && !isValidCnpj(input.company.cnpj)) {
    addIssue(errors, "INVALID_CNPJ", "company.cnpj", "CNPJ inválido.");
  }
  if (!isNonNegativeCents(input.currentPeriodRevenue.internalCents)) {
    addIssue(errors, "INVALID_MONEY", "currentPeriodRevenue.internalCents", "Receita interna deve ser um inteiro não negativo em centavos.");
  }
  if (!isNonNegativeCents(input.currentPeriodRevenue.externalCents)) {
    addIssue(errors, "INVALID_MONEY", "currentPeriodRevenue.externalCents", "Receita externa deve ser um inteiro não negativo em centavos.");
  }
  if (input.activities.length === 0) {
    addIssue(errors, "ACTIVITY_REQUIRED", "activities", "Informe ao menos uma atividade.");
  }

  if (!period || !opening) return { ok: false, errors };

  const monthsBeforePeriod = period.index - opening.monthIndex;
  if (monthsBeforePeriod < 0) {
    addIssue(errors, "OPENING_AFTER_PERIOD", "company.openingDate", "A abertura não pode ser posterior à competência.");
    return { ok: false, errors };
  }

  const historyByPeriod = indexMonthlyRevenue(input.revenueHistory, errors);
  const historyPeriods = requiredHistoryPeriods(period.index, monthsBeforePeriod);
  const historyWindow: MonthlyRevenueInput[] = [];

  for (const requiredPeriod of historyPeriods) {
    const entry = historyByPeriod.get(requiredPeriod);
    if (!entry) {
      addIssue(errors, "MISSING_REVENUE_PERIOD", "revenueHistory", `Falta a receita da competência ${requiredPeriod}.`);
    } else {
      historyWindow.push(entry);
    }
  }

  const currentYearHistory = historyWindow.filter((entry) =>
    parsePeriod(entry.period)?.year === period.year,
  );
  const currentYearInternalFromHistory = currentYearHistory.reduce(
    (sum, entry) => sum + entry.internalCents,
    0,
  );
  const currentYearExternalFromHistory = currentYearHistory.reduce(
    (sum, entry) => sum + entry.externalCents,
    0,
  );
  if (
    currentYearInternalFromHistory
    !== input.sublimit.currentYearInternalRevenueBeforePeriodCents
  ) {
    addIssue(
      errors,
      "CURRENT_YEAR_INTERNAL_REVENUE_MISMATCH",
      "sublimit.currentYearInternalRevenueBeforePeriodCents",
      "A receita interna acumulada antes do PA não fecha com o histórico mensal.",
    );
  }
  if (
    currentYearExternalFromHistory
    !== input.sublimit.currentYearExternalRevenueBeforePeriodCents
  ) {
    addIssue(
      errors,
      "CURRENT_YEAR_EXTERNAL_REVENUE_MISMATCH",
      "sublimit.currentYearExternalRevenueBeforePeriodCents",
      "A receita externa acumulada antes do PA não fecha com o histórico mensal.",
    );
  }

  const ids = new Set<string>();
  let declaredTotalCents = 0;
  let declaredExternalCents = 0;
  let declaredInternalCents = 0;

  input.activities.forEach((activity, activityIndex) => {
    const path = `activities[${activityIndex}]`;
    if (!activity.id.trim()) {
      addIssue(errors, "ACTIVITY_ID_REQUIRED", `${path}.id`, "A atividade precisa de identificador.");
    } else if (ids.has(activity.id)) {
      addIssue(errors, "DUPLICATE_ACTIVITY_ID", `${path}.id`, "Identificador de atividade repetido.");
    }
    ids.add(activity.id);

    if (!isNonNegativeCents(activity.declaredRevenueCents)) {
      addIssue(errors, "INVALID_MONEY", `${path}.declaredRevenueCents`, "Receita declarada deve ser um inteiro não negativo em centavos.");
      return;
    }

    if (activity.annexMode !== "manual" && activity.annexMode !== "factor-r") {
      addIssue(errors, "INVALID_ANNEX_MODE", `${path}.annexMode`, "Modo de seleção do Anexo inválido.");
    }
    if (activity.selectedAnnex && !ANNEXES.includes(activity.selectedAnnex)) {
      addIssue(errors, "INVALID_ANNEX", `${path}.selectedAnnex`, "Anexo inválido.");
    }

    let segmentTotal = 0;
    for (const [code, value] of Object.entries(activity.segments)) {
      const segment = SEGMENTS_BY_CODE.get(code as RevenueSegmentCode);
      if (!segment) {
        addIssue(errors, "UNKNOWN_SEGMENT", `${path}.segments.${code}`, "Segmento de receita desconhecido.");
        continue;
      }
      if (!isNonNegativeCents(value)) {
        addIssue(errors, "INVALID_MONEY", `${path}.segments.${code}`, "Receita do segmento deve ser um inteiro não negativo em centavos.");
        continue;
      }
      segmentTotal += value;
      if (code === "exportacao") declaredExternalCents += value;
      else declaredInternalCents += value;
    }

    if (segmentTotal !== activity.declaredRevenueCents) {
      addIssue(errors, "ACTIVITY_REVENUE_MISMATCH", `${path}.segments`, "A soma dos segmentos deve ser exatamente igual à receita declarada da atividade.");
    }
    declaredTotalCents += activity.declaredRevenueCents;

    if (activity.annexMode === "manual" && !activity.selectedAnnex) {
      addIssue(errors, "ANNEX_REQUIRED", `${path}.selectedAnnex`, "Selecione o Anexo da atividade manual.");
    }
    if (
      activity.annexMode === "factor-r"
      && activity.selectedAnnex
      && activity.selectedAnnex !== "III"
      && activity.selectedAnnex !== "V"
    ) {
      addIssue(errors, "INVALID_FACTOR_R_ANNEX", `${path}.selectedAnnex`, "Atividade sujeita ao Fator R aceita somente Anexo III ou V.");
    }
  });

  const currentTotalCents = input.currentPeriodRevenue.internalCents
    + input.currentPeriodRevenue.externalCents;
  if (declaredTotalCents !== currentTotalCents) {
    addIssue(errors, "SIMULATION_REVENUE_MISMATCH", "activities", "A soma das atividades deve fechar com a receita total do período.");
  }
  if (declaredInternalCents !== input.currentPeriodRevenue.internalCents) {
    addIssue(errors, "INTERNAL_REVENUE_MISMATCH", "activities", "Os segmentos internos não fecham com a receita interna do período.");
  }
  if (declaredExternalCents !== input.currentPeriodRevenue.externalCents) {
    addIssue(errors, "EXTERNAL_REVENUE_MISMATCH", "activities", "O segmento de exportação não fecha com a receita externa do período.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const sublimitResult = evaluateSublimit({
    periodYear: period.year,
    openingYear: opening.year,
    openingMonth: opening.month,
    priorYearInternalRevenueCents: input.sublimit.priorYearInternalRevenueCents,
    priorYearExternalRevenueCents: input.sublimit.priorYearExternalRevenueCents,
    currentYearInternalRevenueBeforePeriodCents:
      input.sublimit.currentYearInternalRevenueBeforePeriodCents,
    currentYearExternalRevenueBeforePeriodCents:
      input.sublimit.currentYearExternalRevenueBeforePeriodCents,
    currentPeriodInternalRevenueCents: input.currentPeriodRevenue.internalCents,
    currentPeriodExternalRevenueCents: input.currentPeriodRevenue.externalCents,
    impededAtPeriodStart: input.sublimit.impededAtPeriodStart,
  });
  if (!sublimitResult.ok) {
    return {
      ok: false,
      errors: sublimitResult.errors.map((issue) => ({
        ...issue,
        path: `sublimit.${issue.path}`,
      })),
    };
  }
  const sublimitEvaluation = sublimitResult.value;
  warnings.push(...sublimitEvaluation.warnings.map((issue) => ({
    ...issue,
    path: `sublimit.${issue.path}`,
  })));
  memory.push({
    code: "sublimit",
    label: "Sublimite de ICMS e ISS",
    formula: "RBAA e RBA separadas entre mercado interno e exportação",
    inputs: {
      sublimitCents: String(sublimitEvaluation.sublimitCents),
      overallLimitCents: String(sublimitEvaluation.overallLimitCents),
    },
    result: sublimitEvaluation.stateTaxMode,
  });

  const historyRevenueTotal = historyWindow.reduce(
    (sum, entry) => sum.plus(entry.internalCents).plus(entry.externalCents),
    new Decimal(0),
  );

  let rateBase: Decimal;
  let basisMode: SimulationValue["revenueBasis"]["mode"];
  if (monthsBeforePeriod === 0) {
    rateBase = new Decimal(currentTotalCents).mul(12);
    basisMode = "first-period-proportionalized";
  } else if (monthsBeforePeriod <= 11) {
    rateBase = historyRevenueTotal.div(monthsBeforePeriod).mul(12);
    basisMode = "startup-proportionalized";
  } else {
    rateBase = historyRevenueTotal;
    basisMode = "rbt12";
  }

  // Meses considerados na base (o divisor da proporcionalizacao, limitado a 12).
  // No primeiro mes ha 1 mes de atividade e a base usa a receita do proprio PA.
  const monthsOfActivity = monthsBeforePeriod === 0 ? 1 : Math.min(monthsBeforePeriod, 12);
  const accumulatedRevenue = monthsBeforePeriod === 0
    ? new Decimal(currentTotalCents)
    : historyRevenueTotal;

  memory.push({
    code: "revenue-basis",
    label: "Base de enquadramento",
    formula: monthsBeforePeriod === 0
      ? "receita do PA x 12"
      : monthsBeforePeriod <= 11
        ? "receitas anteriores / meses anteriores x 12"
        : "soma dos 12 meses anteriores",
    inputs: {
      monthsBeforePeriod: String(monthsBeforePeriod),
      currentRevenueCents: String(currentTotalCents),
      historyRevenueCents: decimalText(historyRevenueTotal),
    },
    result: decimalText(rateBase),
  });

  const band = selectRevenueBand(rateBase);
  if (band === null) {
    addIssue(errors, "GROSS_REVENUE_LIMIT_EXCEEDED", "revenueHistory", "A base supera R$ 4.800.000,00 e está fora do escopo liberado.");
  }

  const usesFactorR = input.activities.some((activity) => activity.annexMode === "factor-r");
  let factorR: string | null = null;

  if (usesFactorR) {
    if (monthsBeforePeriod === 0) {
      if (!isNonNegativeCents(input.payroll.currentPeriodCents)) {
        addIssue(errors, "PAYROLL_REQUIRED", "payroll.currentPeriodCents", "Informe a folha do primeiro período para calcular o Fator R.");
      } else {
        factorR = calculateFactorR(input.payroll.currentPeriodCents, currentTotalCents, true);
        memory.push({
          code: "factor-r",
          label: "Fator R",
          formula: "FSPA / RPA, com regras especiais para bases zeradas",
          inputs: {
            payrollCents: String(input.payroll.currentPeriodCents),
            revenueCents: String(currentTotalCents),
          },
          result: factorR ?? "nao aplicavel",
        });
      }
    } else {
      const payrollByPeriod = indexMonthlyPayroll(input.payroll.history ?? [], errors);
      let payrollTotal = new Decimal(0);
      for (const requiredPeriod of historyPeriods) {
        const entry = payrollByPeriod.get(requiredPeriod);
        if (!entry) {
          addIssue(errors, "MISSING_PAYROLL_PERIOD", "payroll.history", `Falta a folha da competência ${requiredPeriod}.`);
        } else {
          payrollTotal = payrollTotal.plus(entry.valueCents);
        }
      }
      if (!errors.some(({ code }) => code === "MISSING_PAYROLL_PERIOD")) {
        factorR = calculateFactorR(payrollTotal, historyRevenueTotal, false);
        memory.push({
          code: "factor-r",
          label: "Fator R",
          formula: "FS12 / RBT12r, com regras especiais para bases zeradas",
          inputs: {
            payrollCents: decimalText(payrollTotal),
            revenueCents: decimalText(historyRevenueTotal),
          },
          result: factorR ?? "nao aplicavel",
        });
      }
    }
  }

  if (errors.length > 0 || band === null) return { ok: false, errors };

  const activityResults: ActivityResult[] = [];

  input.activities.forEach((activity, activityIndex) => {
    const path = `activities[${activityIndex}]`;
    let suggestedAnnex: Annex | null = null;
    let annex = activity.selectedAnnex ?? null;

    if (activity.annexMode === "factor-r") {
      if (factorR === null && activity.declaredRevenueCents === 0) {
        warnings.push({
          code: "FACTOR_R_NOT_APPLICABLE_WITHOUT_REVENUE",
          path,
          message: "Sem receita no primeiro período, não há enquadramento pelo Fator R neste PA.",
        });
        activityResults.push({
          id: activity.id,
          description: activity.description,
          annex,
          annexSuggestedByFactorR: null,
          band,
          nominalRate: null,
          deductionCents: null,
          effectiveRate: null,
          revenueCents: 0,
          segments: [],
          byTaxCents: emptyMoneyTaxes(),
          totalCents: 0,
          rawTotalCents: "0",
          memory: [{
            code: "activity-without-revenue",
            label: "Atividade sem receita",
            formula: "receita do PA igual a zero",
            inputs: { revenueCents: "0" },
            result: "0",
          }],
        });
        return;
      }
      suggestedAnnex = new Decimal(factorR ?? 0).gte(RULESET_2026.factorRThreshold) ? "III" : "V";
      if (annex && annex !== suggestedAnnex) {
        if (!activity.confirmAnnexOverride) {
          addIssue(errors, "ANNEX_OVERRIDE_CONFIRMATION_REQUIRED", `${path}.confirmAnnexOverride`, "A divergência em relação ao Fator R exige confirmação explícita.");
          return;
        }
        warnings.push({
          code: "ANNEX_OVERRIDE_CONFIRMED",
          path,
          message: `Anexo ${annex} mantido manualmente apesar da sugestão ${suggestedAnnex} pelo Fator R.`,
        });
      } else {
        annex = suggestedAnnex;
      }
    }

    if (!annex) {
      addIssue(errors, "ANNEX_REQUIRED", `${path}.selectedAnnex`, "Não foi possível determinar o Anexo.");
      return;
    }

    const allowedSegments = annex === "I" || annex === "II" ? PRODUCT_SEGMENTS : SERVICE_SEGMENTS;
    for (const [code, value] of Object.entries(activity.segments)) {
      if (Number(value) > 0 && !allowedSegments.has(code as RevenueSegmentCode)) {
        addIssue(errors, "INCOMPATIBLE_SEGMENT", `${path}.segments.${code}`, `O segmento não é compatível com o Anexo ${annex}.`);
      }
    }
    if (errors.length > 0) return;

    const rule = ANNEX_RULES_2026.find((candidate) =>
      candidate.annex === annex && candidate.band === band,
    );
    if (!rule) {
      addIssue(errors, "RULE_NOT_FOUND", path, `Regra ausente para o Anexo ${annex}, faixa ${band}.`);
      return;
    }

    const effectiveRate = new Decimal(calculateEffectiveRate(annex, band, rateBase));
    const baseRates = emptyDecimalTaxes();
    for (const tax of TAXES) baseRates[tax] = effectiveRate.mul(rule.shares[tax]);

    const rawTaxes = emptyDecimalTaxes();
    const segmentResults: SegmentResult[] = [];
    let activityIssCapApplied = false;

    for (const [code, value] of Object.entries(activity.segments)) {
      if (!value) continue;
      const segment = SEGMENTS_BY_CODE.get(code as RevenueSegmentCode);
      if (!segment) continue;

      const market = code === "exportacao" ? "external" : "internal";
      const revenueSplit = sublimitEvaluation.markets[market];
      const { rates, issCapApplied } = blendedRatesForSegment(
        annex,
        band,
        rateBase,
        baseRates,
        revenueSplit,
        sublimitEvaluation.stateTaxMode,
        segment.incidence.iss === 1,
      );
      activityIssCapApplied ||= issCapApplied;
      const segmentRaw = emptyDecimalTaxes();

      for (const tax of TAXES) {
        segmentRaw[tax] = new Decimal(value).mul(rates[tax]).mul(segment.incidence[tax]);
        rawTaxes[tax] = rawTaxes[tax].plus(segmentRaw[tax]);
      }

      segmentResults.push({
        code: code as RevenueSegmentCode,
        revenueCents: value,
        rawTaxCents: Object.fromEntries(
          TAXES.map((tax) => [tax, decimalText(segmentRaw[tax])]),
        ) as unknown as Readonly<Record<Tax, string>>,
        issCapApplied,
        revenueRatios: {
          withinSublimit: revenueSplit.withinSublimitRatio,
          betweenSublimitAndLimit: revenueSplit.betweenSublimitAndLimitRatio,
          aboveOverallLimit: revenueSplit.aboveOverallLimitRatio,
        },
      });
    }

    const reconciled = roundAndReconcile(rawTaxes);
    const activityMemory: CalculationMemoryStep[] = [
      {
        code: "effective-rate",
        label: "Alíquota efetiva",
        formula: "(base × alíquota nominal − parcela a deduzir) ÷ base",
        inputs: {
          rateBaseCents: decimalText(rateBase),
          nominalRate: rule.nominalRate,
          deductionCents: String(rule.deductionCents),
        },
        result: decimalText(effectiveRate),
      },
      {
        code: "activity-total",
        label: "Total da atividade",
        formula: "soma dos tributos por segmento, arredondada e reconciliada em centavos",
        inputs: { revenueCents: String(activity.declaredRevenueCents) },
        result: String(reconciled.totalCents),
      },
    ];
    if (activityIssCapApplied) {
      activityMemory.push({
        code: "iss-cap",
        label: "Teto do ISS",
        formula: "ISS limitado a 5%; excedente redistribuído aos tributos federais",
        inputs: { annex },
        result: RULESET_2026.issRateCap,
      });
    }

    activityResults.push({
      id: activity.id,
      description: activity.description,
      annex,
      annexSuggestedByFactorR: suggestedAnnex,
      band,
      nominalRate: rule.nominalRate,
      deductionCents: rule.deductionCents,
      effectiveRate: decimalText(effectiveRate),
      revenueCents: activity.declaredRevenueCents,
      segments: segmentResults,
      byTaxCents: reconciled.byTaxCents,
      totalCents: reconciled.totalCents,
      rawTotalCents: decimalText(reconciled.rawTotal),
      memory: activityMemory,
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const byTaxCents = emptyMoneyTaxes();
  for (const activity of activityResults) {
    for (const tax of TAXES) byTaxCents[tax] += activity.byTaxCents[tax];
  }
  const totalDasCents = TAXES.reduce((sum, tax) => sum + byTaxCents[tax], 0);

  warnings.push({
    code: "ROUNDING_POLICY_PENDING_PGDAS_VALIDATION",
    path: "result",
    message: "O arredondamento por atividade é provisoriamente reconciliado no maior tributo e ainda será comparado com o PGDAS-D.",
  });

  return {
    ok: true,
    value: {
      ruleSetId: RULESET_2026.id,
      ruleSetVersion: RULESET_2026.version,
      period: input.rulePeriod,
      monthsBeforePeriod,
      revenueBasis: {
        mode: basisMode,
        monthsOfActivity,
        accumulatedRevenueCents: decimalText(accumulatedRevenue),
        rateBaseCents: decimalText(rateBase),
        periods: historyPeriods,
      },
      factorR,
      sublimit: sublimitEvaluation,
      activities: activityResults,
      byTaxCents,
      totalDasCents,
      destinations: {
        federalCents: byTaxCents.irpj + byTaxCents.csll + byTaxCents.cofins
          + byTaxCents.pis + byTaxCents.cpp + byTaxCents.ipi,
        stateCents: byTaxCents.icms,
        municipalCents: byTaxCents.iss,
      },
      warnings,
      memory,
    },
  };
}
