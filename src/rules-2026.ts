export const TAXES = [
  "irpj",
  "csll",
  "cofins",
  "pis",
  "cpp",
  "icms",
  "ipi",
  "iss",
] as const;

export const ANNEXES = ["I", "II", "III", "IV", "V"] as const;

export type Tax = (typeof TAXES)[number];
export type Annex = (typeof ANNEXES)[number];
export type Band = 1 | 2 | 3 | 4 | 5 | 6;
export type DecimalText = string;
export type TaxShares = Readonly<Record<Tax, DecimalText>>;

export const ANNEX_DESCRIPTIONS_2026 = {
  I: "Comércio",
  II: "Indústria",
  III: "Serviços (menor complexidade técnica)",
  IV: "Serviços (construção, limpeza, vigilância, advocacia — CPP fora do DAS)",
  V: "Serviços intelectuais/técnicos (Fator R < 28%)",
} as const satisfies Readonly<Record<Annex, string>>;

export interface RevenueBand {
  readonly band: Band;
  readonly lowerExclusiveCents: number | null;
  readonly upperInclusiveCents: number;
}

export interface AnnexRule {
  readonly annex: Annex;
  readonly band: Band;
  readonly nominalRate: DecimalText;
  readonly deductionCents: number;
  readonly shares: TaxShares;
}

export interface RevenueSegment {
  readonly code: string;
  readonly label: string;
  readonly incidence: Readonly<Record<Tax, 0 | 1>>;
}

export const RULE_SOURCES_2026 = [
  {
    id: "lc-123-2006",
    title: "Lei Complementar 123/2006 - texto vigente",
    url: "https://legis.senado.leg.br/norma/572878/publicacao/34621013",
    supports: "Anexos I a V, aliquotas, deducoes e reparticoes.",
  },
  {
    id: "resolucao-cgsn-140-2018",
    title: "Resolucao CGSN 140/2018 - texto compilado",
    url: "https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278&naoPublicado=&visao=compilado",
    supports: "Calculo, segregacoes, inicio de atividade, sublimite e excesso.",
  },
  {
    id: "sublimite-2026",
    title: "Comunicado do Simples Nacional sobre o sublimite de 2026",
    url: "https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=94c10cc2-7eb5-4ef0-bfb2-5479e72caff8",
    supports: "Sublimite uniforme de ICMS e ISS para 2026.",
  },
  {
    id: "manual-pgdas-d",
    title: "Manual do PGDAS-D",
    url: "https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf",
    supports: "Fluxo operacional e qualificacoes de receita.",
  },
] as const;

export const REVENUE_BANDS_2026 = [
  { band: 1, lowerExclusiveCents: null, upperInclusiveCents: 18_000_000 },
  { band: 2, lowerExclusiveCents: 18_000_000, upperInclusiveCents: 36_000_000 },
  { band: 3, lowerExclusiveCents: 36_000_000, upperInclusiveCents: 72_000_000 },
  { band: 4, lowerExclusiveCents: 72_000_000, upperInclusiveCents: 180_000_000 },
  { band: 5, lowerExclusiveCents: 180_000_000, upperInclusiveCents: 360_000_000 },
  { band: 6, lowerExclusiveCents: 360_000_000, upperInclusiveCents: 480_000_000 },
] as const satisfies readonly RevenueBand[];

export const ANNEX_RULES_2026 = [
  {
    annex: "I", band: 1, nominalRate: "0.04", deductionCents: 0,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1274", pis: "0.0276", cpp: "0.415", icms: "0.34", ipi: "0", iss: "0" },
  },
  {
    annex: "I", band: 2, nominalRate: "0.073", deductionCents: 594_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1274", pis: "0.0276", cpp: "0.415", icms: "0.34", ipi: "0", iss: "0" },
  },
  {
    annex: "I", band: 3, nominalRate: "0.095", deductionCents: 1_386_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1274", pis: "0.0276", cpp: "0.42", icms: "0.335", ipi: "0", iss: "0" },
  },
  {
    annex: "I", band: 4, nominalRate: "0.107", deductionCents: 2_250_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1274", pis: "0.0276", cpp: "0.42", icms: "0.335", ipi: "0", iss: "0" },
  },
  {
    annex: "I", band: 5, nominalRate: "0.143", deductionCents: 8_730_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1274", pis: "0.0276", cpp: "0.42", icms: "0.335", ipi: "0", iss: "0" },
  },
  {
    annex: "I", band: 6, nominalRate: "0.19", deductionCents: 37_800_000,
    shares: { irpj: "0.135", csll: "0.1", cofins: "0.2827", pis: "0.0613", cpp: "0.421", icms: "0", ipi: "0", iss: "0" },
  },
  {
    annex: "II", band: 1, nominalRate: "0.045", deductionCents: 0,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1151", pis: "0.0249", cpp: "0.375", icms: "0.32", ipi: "0.075", iss: "0" },
  },
  {
    annex: "II", band: 2, nominalRate: "0.078", deductionCents: 594_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1151", pis: "0.0249", cpp: "0.375", icms: "0.32", ipi: "0.075", iss: "0" },
  },
  {
    annex: "II", band: 3, nominalRate: "0.1", deductionCents: 1_386_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1151", pis: "0.0249", cpp: "0.375", icms: "0.32", ipi: "0.075", iss: "0" },
  },
  {
    annex: "II", band: 4, nominalRate: "0.112", deductionCents: 2_250_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1151", pis: "0.0249", cpp: "0.375", icms: "0.32", ipi: "0.075", iss: "0" },
  },
  {
    annex: "II", band: 5, nominalRate: "0.147", deductionCents: 8_550_000,
    shares: { irpj: "0.055", csll: "0.035", cofins: "0.1151", pis: "0.0249", cpp: "0.375", icms: "0.32", ipi: "0.075", iss: "0" },
  },
  {
    annex: "II", band: 6, nominalRate: "0.3", deductionCents: 72_000_000,
    shares: { irpj: "0.085", csll: "0.075", cofins: "0.2096", pis: "0.0454", cpp: "0.235", icms: "0", ipi: "0.35", iss: "0" },
  },
  {
    annex: "III", band: 1, nominalRate: "0.06", deductionCents: 0,
    shares: { irpj: "0.04", csll: "0.035", cofins: "0.1282", pis: "0.0278", cpp: "0.434", icms: "0", ipi: "0", iss: "0.335" },
  },
  {
    annex: "III", band: 2, nominalRate: "0.112", deductionCents: 936_000,
    shares: { irpj: "0.04", csll: "0.035", cofins: "0.1405", pis: "0.0305", cpp: "0.434", icms: "0", ipi: "0", iss: "0.32" },
  },
  {
    annex: "III", band: 3, nominalRate: "0.135", deductionCents: 1_764_000,
    shares: { irpj: "0.04", csll: "0.035", cofins: "0.1364", pis: "0.0296", cpp: "0.434", icms: "0", ipi: "0", iss: "0.325" },
  },
  {
    annex: "III", band: 4, nominalRate: "0.16", deductionCents: 3_564_000,
    shares: { irpj: "0.04", csll: "0.035", cofins: "0.1364", pis: "0.0296", cpp: "0.434", icms: "0", ipi: "0", iss: "0.325" },
  },
  {
    annex: "III", band: 5, nominalRate: "0.21", deductionCents: 12_564_000,
    shares: { irpj: "0.04", csll: "0.035", cofins: "0.1282", pis: "0.0278", cpp: "0.434", icms: "0", ipi: "0", iss: "0.335" },
  },
  {
    annex: "III", band: 6, nominalRate: "0.33", deductionCents: 64_800_000,
    shares: { irpj: "0.35", csll: "0.15", cofins: "0.1603", pis: "0.0347", cpp: "0.305", icms: "0", ipi: "0", iss: "0" },
  },
  {
    annex: "IV", band: 1, nominalRate: "0.045", deductionCents: 0,
    shares: { irpj: "0.188", csll: "0.152", cofins: "0.1767", pis: "0.0383", cpp: "0", icms: "0", ipi: "0", iss: "0.445" },
  },
  {
    annex: "IV", band: 2, nominalRate: "0.09", deductionCents: 810_000,
    shares: { irpj: "0.198", csll: "0.152", cofins: "0.2055", pis: "0.0445", cpp: "0", icms: "0", ipi: "0", iss: "0.4" },
  },
  {
    annex: "IV", band: 3, nominalRate: "0.102", deductionCents: 1_242_000,
    shares: { irpj: "0.208", csll: "0.152", cofins: "0.1973", pis: "0.0427", cpp: "0", icms: "0", ipi: "0", iss: "0.4" },
  },
  {
    annex: "IV", band: 4, nominalRate: "0.14", deductionCents: 3_978_000,
    shares: { irpj: "0.178", csll: "0.192", cofins: "0.189", pis: "0.041", cpp: "0", icms: "0", ipi: "0", iss: "0.4" },
  },
  {
    annex: "IV", band: 5, nominalRate: "0.22", deductionCents: 18_378_000,
    shares: { irpj: "0.188", csll: "0.192", cofins: "0.1808", pis: "0.0392", cpp: "0", icms: "0", ipi: "0", iss: "0.4" },
  },
  {
    annex: "IV", band: 6, nominalRate: "0.33", deductionCents: 82_800_000,
    shares: { irpj: "0.535", csll: "0.215", cofins: "0.2055", pis: "0.0445", cpp: "0", icms: "0", ipi: "0", iss: "0" },
  },
  {
    annex: "V", band: 1, nominalRate: "0.155", deductionCents: 0,
    shares: { irpj: "0.25", csll: "0.15", cofins: "0.141", pis: "0.0305", cpp: "0.2885", icms: "0", ipi: "0", iss: "0.14" },
  },
  {
    annex: "V", band: 2, nominalRate: "0.18", deductionCents: 450_000,
    shares: { irpj: "0.23", csll: "0.15", cofins: "0.141", pis: "0.0305", cpp: "0.2785", icms: "0", ipi: "0", iss: "0.17" },
  },
  {
    annex: "V", band: 3, nominalRate: "0.195", deductionCents: 990_000,
    shares: { irpj: "0.24", csll: "0.15", cofins: "0.1492", pis: "0.0323", cpp: "0.2385", icms: "0", ipi: "0", iss: "0.19" },
  },
  {
    annex: "V", band: 4, nominalRate: "0.205", deductionCents: 1_710_000,
    shares: { irpj: "0.21", csll: "0.15", cofins: "0.1574", pis: "0.0341", cpp: "0.2385", icms: "0", ipi: "0", iss: "0.21" },
  },
  {
    annex: "V", band: 5, nominalRate: "0.23", deductionCents: 6_210_000,
    shares: { irpj: "0.23", csll: "0.125", cofins: "0.141", pis: "0.0305", cpp: "0.2385", icms: "0", ipi: "0", iss: "0.235" },
  },
  {
    annex: "V", band: 6, nominalRate: "0.305", deductionCents: 54_000_000,
    shares: { irpj: "0.35", csll: "0.155", cofins: "0.1644", pis: "0.0356", cpp: "0.295", icms: "0", ipi: "0", iss: "0" },
  },
] as const satisfies readonly AnnexRule[];

export const ISS_EXCESS_REDISTRIBUTION_2026 = {
  III: { irpj: "0.0602", csll: "0.0526", cofins: "0.1928", pis: "0.0418", cpp: "0.6526" },
  IV: { irpj: "0.3133", csll: "0.32", cofins: "0.3013", pis: "0.0654", cpp: "0" },
  V: { irpj: "0.3007", csll: "0.1634", cofins: "0.1843", pis: "0.0399", cpp: "0.3117" },
} as const;

export const REVENUE_SEGMENTS_2026 = [
  {
    code: "icms_normal_pis_cofins_normal",
    label: "ICMS normal + PIS/COFINS normal",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 1, ipi: 1, iss: 1 },
  },
  {
    code: "icms_normal_pis_cofins_monofasico",
    label: "ICMS normal + PIS/COFINS monofasico",
    incidence: { irpj: 1, csll: 1, cofins: 0, pis: 0, cpp: 1, icms: 1, ipi: 1, iss: 1 },
  },
  {
    code: "icms_st_pis_cofins_normal",
    label: "ICMS ST + PIS/COFINS normal",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 0, ipi: 1, iss: 1 },
  },
  {
    code: "icms_st_pis_cofins_monofasico",
    label: "ICMS ST + PIS/COFINS monofasico",
    incidence: { irpj: 1, csll: 1, cofins: 0, pis: 0, cpp: 1, icms: 0, ipi: 1, iss: 1 },
  },
  {
    code: "icms_isento_pis_cofins_normal",
    label: "ICMS isento/nao incidencia + PIS/COFINS normal",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 0, ipi: 1, iss: 1 },
  },
  {
    code: "icms_isento_pis_cofins_monofasico",
    label: "ICMS isento/nao incidencia + PIS/COFINS monofasico",
    incidence: { irpj: 1, csll: 1, cofins: 0, pis: 0, cpp: 1, icms: 0, ipi: 1, iss: 1 },
  },
  {
    code: "iss_normal",
    label: "ISS normal",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 1, ipi: 1, iss: 1 },
  },
  {
    code: "iss_isento_imune",
    label: "ISS isento/imune",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 1, ipi: 1, iss: 0 },
  },
  {
    code: "iss_retido",
    label: "ISS retido pelo tomador",
    incidence: { irpj: 1, csll: 1, cofins: 1, pis: 1, cpp: 1, icms: 1, ipi: 1, iss: 0 },
  },
  {
    code: "exportacao",
    label: "Exportacao",
    incidence: { irpj: 1, csll: 1, cofins: 0, pis: 0, cpp: 1, icms: 0, ipi: 0, iss: 0 },
  },
] as const satisfies readonly RevenueSegment[];

export const RULESET_2026 = {
  id: "simples-nacional-2026",
  version: "2026.1",
  period: { from: "2026-01", through: "2026-12" },
  maximumGrossRevenueCents: 480_000_000,
  stateAndMunicipalSublimitCents: 360_000_000,
  factorRThreshold: "0.28",
  issRateCap: "0.05",
  workbookReference: {
    file: "6. Simulador Simples Nacional/Simulador_Simples_Nacional_2026_.xlsx",
    sheet: "Tabelas Anexos",
    ranges: {
      revenueBands: "A6:D11",
      annexRules: "A16:N45",
      revenueSegments: "A50:I59",
    },
    sha256: "0763D14577C384B88D64881B1F83878732FAB3E7AE82EC01B97A2C77D91C4D1D",
  },
  sources: RULE_SOURCES_2026,
  annexDescriptions: ANNEX_DESCRIPTIONS_2026,
  revenueBands: REVENUE_BANDS_2026,
  annexRules: ANNEX_RULES_2026,
  revenueSegments: REVENUE_SEGMENTS_2026,
  issExcessRedistribution: ISS_EXCESS_REDISTRIBUTION_2026,
} as const;
