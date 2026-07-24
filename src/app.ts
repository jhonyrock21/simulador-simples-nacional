import "./styles.css";

import {
  planHistory,
  simulate,
  type ActivityInput,
  type MonthlyRevenueInput,
  type RevenueSegmentCode,
  type SimulationInput,
  type SimulationIssue,
  type SimulationValue,
} from "./calc";
import {
  formatCents,
  formatCentsText,
  formatCnpjInput,
  formatMoneyInput,
  formatNumericInputWithCaret,
  formatPercentText,
  parseMoneyToCents,
} from "./money";
import {
  ANNEXES,
  ANNEX_DESCRIPTIONS_2026,
  REVENUE_SEGMENTS_2026,
  RULESET_2026,
  TAXES,
  type Annex,
  type Tax,
} from "./rules-2026";
import { buildXlsxBlob, XLSX_STYLES, type XlsxCell, type XlsxSheet, type XlsxStyleId } from "./xlsx";

// ---------------------------------------------------------------------------
// Constantes de apresentacao (rotulos; nenhuma formula fiscal vive aqui)
// ---------------------------------------------------------------------------

const PRODUCT_SEGMENTS: RevenueSegmentCode[] = [
  "icms_normal_pis_cofins_normal",
  "icms_normal_pis_cofins_monofasico",
  "icms_st_pis_cofins_normal",
  "icms_st_pis_cofins_monofasico",
  "icms_isento_pis_cofins_normal",
  "icms_isento_pis_cofins_monofasico",
  "exportacao",
];

const SERVICE_SEGMENTS: RevenueSegmentCode[] = [
  "iss_normal",
  "iss_isento_imune",
  "iss_retido",
  "exportacao",
];

const SEGMENT_LABELS = new Map(
  REVENUE_SEGMENTS_2026.map((segment) => [segment.code, segment.label] as const),
);

const TAX_LABELS: Record<Tax, string> = {
  irpj: "IRPJ",
  csll: "CSLL",
  cofins: "COFINS",
  pis: "PIS/Pasep",
  cpp: "CPP",
  icms: "ICMS",
  ipi: "IPI",
  iss: "ISS",
};

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const BASIS_LABELS: Record<SimulationValue["revenueBasis"]["mode"], string> = {
  "first-period-proportionalized": "Receita do PA × 12",
  "startup-proportionalized": "Receitas anteriores ÷ meses × 12",
  rbt12: "Soma dos 12 meses anteriores",
};

// ---------------------------------------------------------------------------
// Escape de texto do usuario
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Modelo do formulario (todas as entradas ficam como texto cru)
// ---------------------------------------------------------------------------

interface ActivityModel {
  description: string;
  annexMode: "manual" | "factor-r";
  selectedAnnex: Annex | "";
  overrideAnnex: Annex | "";
  confirmOverride: boolean;
  segments: Partial<Record<RevenueSegmentCode, string>>;
}

interface HistoryCell {
  internal: string;
  external: string;
  payroll: string;
}

interface FormModel {
  name: string;
  cnpj: string;
  openingDate: string;
  rulePeriod: string;
  historyMode: "quick" | "detailed";
  rbt12Internal: string;
  rbt12External: string;
  fs12Total: string;
  priorInternal: string;
  priorExternal: string;
  currentYearInternalBefore: string;
  currentYearExternalBefore: string;
  impeded: boolean;
  firstPeriodPayroll: string;
  history: Record<string, HistoryCell>;
  activities: ActivityModel[];
}

function emptyActivity(): ActivityModel {
  return {
    description: "",
    annexMode: "manual",
    selectedAnnex: "",
    overrideAnnex: "",
    confirmOverride: false,
    segments: {},
  };
}

function defaultModel(): FormModel {
  return {
    name: "",
    cnpj: "",
    openingDate: "",
    rulePeriod: RULESET_2026.period.from,
    historyMode: "quick",
    rbt12Internal: "",
    rbt12External: "",
    fs12Total: "",
    priorInternal: "",
    priorExternal: "",
    currentYearInternalBefore: "",
    currentYearExternalBefore: "",
    impeded: false,
    firstPeriodPayroll: "",
    history: {},
    activities: [emptyActivity()],
  };
}

// ponytail: exemplo temporario da planilha (R$ 29.794,04) para aprender o
// preenchimento. Remover este model e o botao "load-example" quando nao precisar.
function exampleModel(): FormModel {
  const base = defaultModel();
  base.name = "Exemplo Comércio LTDA";
  base.openingDate = "2019-06-18";
  base.rulePeriod = "2026-06";
  base.historyMode = "quick";
  base.rbt12Internal = "1.522.284,18";
  base.activities = [{
    description: "Comércio varejista",
    annexMode: "manual",
    selectedAnnex: "I",
    overrideAnnex: "",
    confirmOverride: false,
    segments: {
      icms_normal_pis_cofins_normal: "179.361,40",
      icms_st_pis_cofins_normal: "18.523,55",
      icms_st_pis_cofins_monofasico: "257.642,38",
    },
  }];
  return base;
}

let model = defaultModel();

function historyCell(period: string): HistoryCell {
  return model.history[period] ?? { internal: "", external: "", payroll: "" };
}

function usesFactorR(): boolean {
  return model.activities.some((activity) => activity.annexMode === "factor-r");
}

function allowedSegments(activity: ActivityModel): RevenueSegmentCode[] {
  if (activity.annexMode === "factor-r") return SERVICE_SEGMENTS;
  if (activity.selectedAnnex === "I" || activity.selectedAnnex === "II") return PRODUCT_SEGMENTS;
  if (activity.selectedAnnex === "") return [];
  return SERVICE_SEGMENTS;
}

// ---------------------------------------------------------------------------
// Montagem do SimulationInput canonico
// ---------------------------------------------------------------------------

interface BuildOutput {
  input: SimulationInput;
  moneyErrors: string[];
  inputErrors: SimulationIssue[];
}

function quickHistoryEnabled(plan: { monthsBeforePeriod: number }): boolean {
  return model.historyMode === "quick" && plan.monthsBeforePeriod >= 12;
}

function synthesizeQuickHistory(
  periods: readonly string[],
  periodYear: number,
  internalTotal: number,
  externalTotal: number,
  currentYearInternalBefore: number,
  currentYearExternalBefore: number,
  inputErrors: SimulationIssue[],
): MonthlyRevenueInput[] {
  const rows = periods.map((period) => ({ period, internalCents: 0, externalCents: 0 }));
  const currentYearRows = rows.filter((row) => row.period.slice(0, 4) === String(periodYear));
  const previousYearRows = rows.filter((row) => row.period.slice(0, 4) !== String(periodYear));

  const assign = (
    total: number,
    currentYearBefore: number,
    key: "internalCents" | "externalCents",
    label: string,
  ): void => {
    if (currentYearBefore > total) {
      inputErrors.push({
        code: "QUICK_RBT12_SPLIT_INVALID",
        path: `base rápida/${label}`,
        message: `A RBA do ano atual antes do PA não pode ser maior que a RBT12 de ${label}. Em janeiro, deixe esse campo em 0,00; em simulação comum abaixo do sublimite, ele também pode ficar zerado.`,
      });
      return;
    }

    if (currentYearBefore > 0) {
      const currentTarget = currentYearRows.at(-1);
      if (!currentTarget) {
        inputErrors.push({
        code: "QUICK_RBT12_SPLIT_INVALID",
        path: `base rápida/${label}`,
        message: "PA de janeiro não possui receita anterior no mesmo ano; deixe a RBA atual antes do PA em 0,00.",
      });
      } else {
        currentTarget[key] += currentYearBefore;
      }
    }

    const remaining = total - currentYearBefore;
    if (remaining <= 0) return;

    const previousTarget = previousYearRows.at(-1) ?? rows.at(0);
    if (previousTarget) previousTarget[key] += remaining;
  };

  assign(internalTotal, currentYearInternalBefore, "internalCents", "mercado interno");
  assign(externalTotal, currentYearExternalBefore, "externalCents", "exportação");
  return rows;
}

function buildSimulation(plan: {
  monthsBeforePeriod: number;
  periods: readonly string[];
  periodYear: number;
  startupYear: boolean;
}): BuildOutput {
  const moneyErrors: string[] = [];
  const inputErrors: SimulationIssue[] = [];
  const money = (raw: string, key: string): number => {
    const cents = parseMoneyToCents(raw);
    if (cents === null) {
      moneyErrors.push(key);
      return 0;
    }
    return cents;
  };

  const periodYear = model.rulePeriod.slice(0, 4);
  const isQuick = quickHistoryEnabled(plan);
  const rbt12Internal = isQuick ? money(model.rbt12Internal, "field:rbt12Internal") : 0;
  const rbt12External = isQuick ? money(model.rbt12External, "field:rbt12External") : 0;
  const quickCurrentYearInternal = isQuick
    ? money(model.currentYearInternalBefore, "field:currentYearInternalBefore")
    : 0;
  const quickCurrentYearExternal = isQuick
    ? money(model.currentYearExternalBefore, "field:currentYearExternalBefore")
    : 0;

  const revenueHistory = isQuick
    ? synthesizeQuickHistory(
      plan.periods,
      plan.periodYear,
      rbt12Internal,
      rbt12External,
      quickCurrentYearInternal,
      quickCurrentYearExternal,
      inputErrors,
    )
    : plan.periods.map((period) => {
      const cell = historyCell(period);
      return {
        period,
        internalCents: money(cell.internal, `hist:${period}:internal`),
        externalCents: money(cell.external, `hist:${period}:external`),
      };
    });

  let currentYearInternal = 0;
  let currentYearExternal = 0;
  for (const entry of revenueHistory) {
    if (entry.period.slice(0, 4) === periodYear) {
      currentYearInternal += entry.internalCents;
      currentYearExternal += entry.externalCents;
    }
  }

  const activities: ActivityInput[] = model.activities.map((activity, index) => {
    const codes = allowedSegments(activity);
    const segments: Partial<Record<RevenueSegmentCode, number>> = {};
    for (const code of codes) {
      const raw = activity.segments[code] ?? "";
      if (raw.trim() === "") continue;
      segments[code] = money(raw, `seg:${index}:${code}`);
    }
    const declaredRevenueCents = Object.values(segments)
      .reduce((sum, value) => sum + (value ?? 0), 0);

    const selectedAnnex: Annex | undefined = activity.annexMode === "manual"
      ? (activity.selectedAnnex || undefined)
      : (activity.overrideAnnex || undefined);

    return {
      id: `atividade-${index + 1}`,
      description: activity.description.trim() || `Atividade ${index + 1}`,
      annexMode: activity.annexMode,
      selectedAnnex,
      confirmAnnexOverride: activity.confirmOverride,
      declaredRevenueCents,
      segments,
    };
  });

  let internalCents = 0;
  let externalCents = 0;
  for (const activity of activities) {
    for (const [code, value] of Object.entries(activity.segments)) {
      if (code === "exportacao") externalCents += value ?? 0;
      else internalCents += value ?? 0;
    }
  }

  const payroll: SimulationInput["payroll"] = {};
  if (usesFactorR()) {
    if (isQuick) {
      const fs12Total = money(model.fs12Total, "field:fs12Total");
      payroll.history = plan.periods.map((period, index) => ({
        period,
        valueCents: index === plan.periods.length - 1 ? fs12Total : 0,
      }));
    } else if (plan.periods.length === 0) {
      payroll.currentPeriodCents = money(model.firstPeriodPayroll, "field:firstPeriodPayroll");
    } else {
      payroll.history = plan.periods.map((period) => ({
        period,
        valueCents: money(historyCell(period).payroll, `hist:${period}:payroll`),
      }));
    }
  }

  const input: SimulationInput = {
    rulePeriod: model.rulePeriod,
    company: {
      name: model.name.trim() || undefined,
      cnpj: model.cnpj.trim() || undefined,
      openingDate: model.openingDate,
    },
    revenueHistory,
    currentPeriodRevenue: { internalCents, externalCents },
    payroll,
    sublimit: {
      priorYearInternalRevenueCents: plan.startupYear ? 0 : money(model.priorInternal, "field:priorInternal"),
      priorYearExternalRevenueCents: plan.startupYear ? 0 : money(model.priorExternal, "field:priorExternal"),
      currentYearInternalRevenueBeforePeriodCents: currentYearInternal,
      currentYearExternalRevenueBeforePeriodCents: currentYearExternal,
      impededAtPeriodStart: model.impeded,
    },
    activities,
  };

  return { input, moneyErrors, inputErrors };
}

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento ausente: ${id}`);
  return node as T;
}

const historyRoot = el<HTMLDivElement>("history-root");
const activitiesRoot = el<HTMLDivElement>("activities-root");
const resultRoot = el<HTMLElement>("result");
const periodHint = el<HTMLParagraphElement>("period-hint");
const rulesetBadge = el<HTMLParagraphElement>("ruleset-badge");
let latestSimulation: SimulationValue | null = null;

// ---------------------------------------------------------------------------
// Render das secoes dinamicas (historico e atividades)
// ---------------------------------------------------------------------------

function moneyInput(key: string, value: string, dataset: string): string {
  return `<input class="field__input" type="text" inputmode="decimal" data-money data-money-key="${key}" ${dataset} value="${escapeHtml(value)}" placeholder="0,00" />`;
}

function renderHistory(plan: { monthsBeforePeriod: number; periods: readonly string[] } | null): void {
  if (!plan) {
    historyRoot.innerHTML = `<p class="block__hint">Informe a data de abertura e a competência para carregar as competências exigidas.</p>`;
    return;
  }

  const factorR = usesFactorR();
  const quickAvailable = plan.monthsBeforePeriod >= 12;
  if (!quickAvailable && model.historyMode === "quick") {
    model.historyMode = "detailed";
  }

  const modeToggle = quickAvailable
    ? `<div class="mode-toggle mode-toggle--segmented history-mode">
         <label><input type="radio" name="history-mode" value="quick" data-field="historyMode" data-structural ${model.historyMode === "quick" ? "checked" : ""} /> RBT12 rápido</label>
         <label><input type="radio" name="history-mode" value="detailed" data-field="historyMode" data-structural ${model.historyMode === "detailed" ? "checked" : ""} /> Histórico mensal</label>
       </div>`
    : "";

  if (plan.periods.length === 0) {
    // Primeiro periodo de atividade: sem historico; RBT12 vem da receita do PA.
    const payrollField = factorR
      ? `<label class="field" style="max-width:260px;margin-top:0.6rem">
           <span class="field__label">Folha do período (FSPA)</span>
           ${moneyInput("field:firstPeriodPayroll", model.firstPeriodPayroll, 'data-field="firstPeriodPayroll"')}
         </label>`
      : "";
    historyRoot.innerHTML =
      `<p class="block__hint">Primeiro mês de atividade: a base de enquadramento usa a receita do próprio PA multiplicada por 12. Não há histórico a informar.</p>${payrollField}`;
    return;
  }

  if (quickAvailable && model.historyMode === "quick") {
    const payrollField = factorR
      ? `<label class="field">
           <span class="field__label">FS12 - folha dos 12 meses anteriores</span>
           ${moneyInput("field:fs12Total", model.fs12Total, 'data-field="fs12Total"')}
         </label>`
      : "";

    historyRoot.innerHTML = `
      ${modeToggle}
      <p class="block__hint">Empresa estabelecida: informe a RBT12 dos 12 meses anteriores, como na planilha. Se não houver exportação, preencha apenas mercado interno.</p>
      <div class="grid">
        <label class="field">
          <span class="field__label">RBT12 - mercado interno</span>
          ${moneyInput("field:rbt12Internal", model.rbt12Internal, 'data-field="rbt12Internal"')}
        </label>
        <label class="field">
          <span class="field__label">RBT12 - exportação <em>(opcional)</em></span>
          ${moneyInput("field:rbt12External", model.rbt12External, 'data-field="rbt12External"')}
        </label>
        ${payrollField}
      </div>
      <p class="block__hint block__hint--compact">Casos com sublimite, faixa 6 ou excesso de ICMS/ISS devem conferir os dados avançados de RBAA e ano atual.</p>`;
    return;
  }

  const periodYear = model.rulePeriod.slice(0, 4);
  const rows = plan.periods.map((period) => {
    const cell = historyCell(period);
    const [year, month] = period.split("-");
    const label = `${MONTHS_PT[Number(month) - 1]}/${year}`;
    const isCurrent = year === periodYear;
    const payrollCell = factorR
      ? `<td>${moneyInput(`hist:${period}:payroll`, cell.payroll, `data-hist-period="${period}" data-hist-kind="payroll"`)}</td>`
      : "";
    return `<tr class="${isCurrent ? "is-current" : ""}">
      <td>${label}</td>
      <td>${moneyInput(`hist:${period}:internal`, cell.internal, `data-hist-period="${period}" data-hist-kind="internal"`)}</td>
      <td>${moneyInput(`hist:${period}:external`, cell.external, `data-hist-period="${period}" data-hist-kind="external"`)}</td>
      ${payrollCell}
    </tr>`;
  }).join("");

  historyRoot.innerHTML = `
    ${modeToggle}
    <p class="block__hint">${plan.monthsBeforePeriod} competência(s) antes do PA. Meses sem receita contam no divisor; não anualize valores manualmente.</p>
    <div class="table-scroll">
      <table class="history-table">
        <thead>
          <tr>
            <th>Competência</th>
            <th>Mercado interno</th>
            <th>Exportação</th>
            ${factorR ? "<th>Folha</th>" : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderActivities(): void {
  activitiesRoot.innerHTML = model.activities.map((activity, index) => {
    const codes = allowedSegments(activity);
    const segmentsHtml = codes.length === 0
      ? `<p class="block__hint">Selecione o Anexo para liberar os segmentos de receita.</p>`
      : `<div class="segments">${codes.map((code) => `
          <label class="field">
            <span class="field__label">${escapeHtml(SEGMENT_LABELS.get(code) ?? code)}</span>
            ${moneyInput(`seg:${index}:${code}`, activity.segments[code] ?? "", `data-act-index="${index}" data-seg="${code}"`)}
          </label>`).join("")}</div>`;

    const annexOptions = ANNEXES.map((annex) =>
      `<option value="${annex}" ${activity.selectedAnnex === annex ? "selected" : ""}>Anexo ${annex} - ${ANNEX_DESCRIPTIONS_2026[annex]}</option>`,
    ).join("");

    const manualSelect = activity.annexMode === "manual"
      ? `<label class="field" style="margin-top:0.6rem;max-width:420px">
           <span class="field__label">Anexo</span>
           <select class="field__select" data-act-index="${index}" data-actfield="selectedAnnex" data-structural>
             <option value="">Selecione...</option>
             ${annexOptions}
           </select>
         </label>`
      : "";

    const overrideSelect = activity.annexMode === "factor-r"
      ? `<div class="override">
           <div class="override__row">
             <label class="field" style="max-width:220px">
               <span class="field__label">Substituir sugestão <em>(avançado)</em></span>
               <select class="field__select" data-act-index="${index}" data-actfield="overrideAnnex" data-structural>
                 <option value="">Usar Fator R</option>
                 <option value="III" ${activity.overrideAnnex === "III" ? "selected" : ""}>Forçar Anexo III</option>
                 <option value="V" ${activity.overrideAnnex === "V" ? "selected" : ""}>Forçar Anexo V</option>
               </select>
             </label>
             <label class="field--check" style="margin-top:1.4rem">
               <input type="checkbox" data-act-index="${index}" data-actfield="confirmOverride" ${activity.confirmOverride ? "checked" : ""} />
               <span class="field__label">Confirmo a substituição</span>
             </label>
           </div>
         </div>`
      : "";

    const removeBtn = model.activities.length > 1
      ? `<button class="btn btn--danger" type="button" data-remove-index="${index}" title="Remover atividade">Remover</button>`
      : "";

    return `<div class="activity">
      <div class="activity__head">
        <span class="activity__name">Atividade ${index + 1}</span>
        ${removeBtn}
      </div>
      <label class="field">
        <span class="field__label">Descrição</span>
        <input class="field__input" type="text" data-act-index="${index}" data-actfield="description" value="${escapeHtml(activity.description)}" placeholder="Ex.: comércio varejista" />
      </label>
      <div class="mode-toggle" style="margin-top:0.6rem">
        <label><input type="radio" name="mode-${index}" value="manual" data-act-index="${index}" data-actfield="annexMode" data-structural ${activity.annexMode === "manual" ? "checked" : ""} /> Anexo manual</label>
        <label><input type="radio" name="mode-${index}" value="factor-r" data-act-index="${index}" data-actfield="annexMode" data-structural ${activity.annexMode === "factor-r" ? "checked" : ""} /> Fator R (III/V)</label>
      </div>
      ${manualSelect}
      ${overrideSelect}
      ${segmentsHtml}
    </div>`;
  }).join("");
}

function updateAdvancedFields(startupYear: boolean, quickEstablished: boolean): void {
  const grid = document.getElementById("prior-year-grid");
  if (grid) {
    for (const input of grid.querySelectorAll<HTMLInputElement>("input")) {
      input.disabled = startupYear;
      input.placeholder = startupYear ? "não se aplica no ano de abertura" : "0,00";
    }
  }

  const currentGrid = document.getElementById("current-year-grid");
  if (currentGrid) {
    for (const input of currentGrid.querySelectorAll<HTMLInputElement>("input")) {
      input.disabled = !quickEstablished;
      input.placeholder = quickEstablished ? "0,00" : "calculado pelo histórico mensal";
    }
  }

  const hint = document.getElementById("current-year-hint");
  if (hint) {
    hint.textContent = quickEstablished
      ? "Opcional no modo rápido; informe apenas se estiver conferindo sublimite/excesso de ICMS/ISS."
      : "No modo mensal, o acumulado do ano atual é calculado automaticamente pelo histórico informado.";
  }
}

// ---------------------------------------------------------------------------
// Render do resultado
// ---------------------------------------------------------------------------

function renderEmpty(message: string): void {
  latestSimulation = null;
  resultRoot.innerHTML = `<div class="result__empty">${message}</div>`;
}

function renderErrors(issues: readonly SimulationIssue[]): void {
  latestSimulation = null;
  const items = issues.map((issue) =>
    `<div class="notice notice--error">${escapeHtml(issue.message)}</div>`,
  ).join("");
  resultRoot.innerHTML = `<div class="panel">
    <h2 class="panel__title">Corrija antes de simular</h2>
    ${items}
  </div>`;
}

// ---------------------------------------------------------------------------
// PDF local da simulacao
// ---------------------------------------------------------------------------

type PdfFont = "F1" | "F2" | "F3";
type PdfColorName = "body" | "muted" | "navy" | "blue" | "coral" | "white";
type PdfLineRole = "normal" | "title" | "section" | "total" | "note";

interface PdfTextLine {
  readonly text: string;
  readonly size: number;
  readonly font: PdfFont;
  readonly indent: number;
  readonly gapBefore: number;
  readonly color: PdfColorName;
  readonly role: PdfLineRole;
}

interface PdfLogoImage {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

const PDF_ENCODER = new TextEncoder();
const PDF_COLORS: Record<PdfColorName, readonly [number, number, number]> = {
  body: [0, 22, 39],
  muted: [71, 109, 130],
  navy: [1, 42, 72],
  blue: [19, 73, 110],
  coral: [254, 88, 46],
  white: [255, 255, 255],
};

let pdfLogoPromise: Promise<PdfLogoImage | null> | null = null;

function sanitizePdfText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/×/g, "x")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function winAnsiHex(value: string): string {
  const replacements = new Map<string, string>([
    ["“", '"'],
    ["”", '"'],
    ["‘", "'"],
    ["’", "'"],
  ]);
  const bytes: number[] = [];

  for (const char of sanitizePdfText(value)) {
    const mapped = replacements.get(char) ?? char;
    for (const item of mapped) {
      const code = item.codePointAt(0) ?? 63;
      if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
        bytes.push(code);
      } else {
        bytes.push(63);
      }
    }
  }

  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("")}>`;
}

function pushWrappedLine(
  lines: PdfTextLine[],
  text: string,
  options: Partial<PdfTextLine> = {},
): void {
  const size = options.size ?? 9;
  const font = options.font ?? "F1";
  const indent = options.indent ?? 0;
  const firstGap = options.gapBefore ?? 0;
  const color = options.color ?? "body";
  const role = options.role ?? "normal";
  const maxChars = Math.max(38, Math.floor((92 - indent / 6) * (9 / size)));
  const words = sanitizePdfText(text).split(" ");
  let current = "";
  let lineIndex = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        lines.push({
          text: current,
          size,
          font,
          indent,
          color,
          role,
          gapBefore: lineIndex === 0 ? firstGap : 0,
        });
        lineIndex += 1;
      }
      current = word;
    }
  }

  if (current || text.trim() === "") {
    lines.push({
      text: current,
      size,
      font,
      indent,
      color,
      role,
      gapBefore: lineIndex === 0 ? firstGap : 0,
    });
  }
}

function pdfSection(lines: PdfTextLine[], title: string): void {
  pushWrappedLine(lines, title.toUpperCase(), {
    size: 11,
    font: "F2",
    color: "navy",
    role: "section",
    gapBefore: lines.length === 0 ? 0 : 8,
  });
}

function simulationRevenueSummary(value: SimulationValue): {
  activityRevenue: number;
  internalRevenue: number;
  externalRevenue: number;
} {
  const activityRevenue = value.activities.reduce((sum, activity) => sum + activity.revenueCents, 0);
  const externalRevenue = value.activities.reduce((sum, activity) =>
    sum + activity.segments
      .filter((segment) => segment.code === "exportacao")
      .reduce((innerSum, segment) => innerSum + segment.revenueCents, 0),
  0);
  return {
    activityRevenue,
    externalRevenue,
    internalRevenue: activityRevenue - externalRevenue,
  };
}

function companySlug(): string {
  return (model.name.trim() || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40) || "empresa";
}

function shortText(value: string, length: number): string {
  const text = sanitizePdfText(value);
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 3))}...`;
}

function padColumn(value: string, length: number): string {
  return shortText(value, length).padEnd(length, " ");
}

function buildPdfLines(value: SimulationValue): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  const generatedAt = new Date().toLocaleString("pt-BR");
  const { activityRevenue, externalRevenue, internalRevenue } = simulationRevenueSummary(value);

  pushWrappedLine(lines, "Demonstrativo de Simulacao do Simples Nacional", {
    size: 15,
    font: "F2",
    color: "navy",
    role: "title",
  });
  pushWrappedLine(lines, `${model.name.trim() || "Empresa nao informada"}   -   Competencia ${value.period}`, {
    size: 9.5,
    font: "F2",
    color: "blue",
    role: "note",
    gapBefore: 3,
  });
  pushWrappedLine(lines, `Emitido em ${generatedAt}. Documento de apoio; nao substitui o PGDAS-D nem a revisao fiscal.`, {
    size: 8,
    color: "muted",
    role: "note",
  });

  pdfSection(lines, "Empresa e periodo");
  pushWrappedLine(lines, `Empresa: ${model.name.trim() || "Nao informada"}`);
  pushWrappedLine(lines, `CNPJ: ${model.cnpj.trim() || "Nao informado"}`);
  pushWrappedLine(lines, `Data de abertura: ${model.openingDate || "Nao informada"}`);
  pushWrappedLine(lines, `Competencia: ${value.period}`);

  pdfSection(lines, "Receitas informadas");
  pushWrappedLine(lines, `Receita do PA - mercado interno: ${formatCents(internalRevenue)}`);
  pushWrappedLine(lines, `Receita do PA - exportacao: ${formatCents(externalRevenue)}`);
  pushWrappedLine(lines, `Receita total do PA: ${formatCents(activityRevenue)}`);

  pdfSection(lines, "Bases do calculo");
  pushWrappedLine(lines, `Meses de atividade: ${value.revenueBasis.monthsOfActivity}`);
  pushWrappedLine(lines, `RBT12 real acumulada: ${formatCentsText(value.revenueBasis.accumulatedRevenueCents)}`);
  pushWrappedLine(lines, `RBT12 utilizada: ${formatCentsText(value.revenueBasis.rateBaseCents)} (${BASIS_LABELS[value.revenueBasis.mode]})`);
  if (value.factorR) pushWrappedLine(lines, `Fator R: ${formatPercentText(value.factorR, 2)}`);
  pushWrappedLine(lines, `Regime ICMS/ISS: ${value.sublimit.stateTaxMode === "inside-das" ? "dentro do DAS" : "fora do DAS"}`);

  pdfSection(lines, "Resumo do DAS");
  pushWrappedLine(lines, `Total estimado do DAS: ${formatCents(value.totalDasCents)}`, {
    size: 13,
    font: "F2",
    color: "white",
    role: "total",
    gapBefore: 4,
  });
  pushWrappedLine(lines, `Uniao: ${formatCents(value.destinations.federalCents)}   |   Estado: ${formatCents(value.destinations.stateCents)}   |   Municipio: ${formatCents(value.destinations.municipalCents)}`, {
    gapBefore: 4,
  });

  pdfSection(lines, "Atividades");
  pushWrappedLine(lines, "Atividade                 Anexo  Faixa  Aliq.      Receita       Total", {
    font: "F3",
    size: 8,
    color: "blue",
  });
  for (const activity of value.activities) {
    const row = [
      padColumn(activity.description, 25),
      padColumn(activity.annex ? `Anexo ${activity.annex}` : "-", 7),
      padColumn(`F${activity.band}`, 6),
      padColumn(formatPercentText(activity.effectiveRate), 10),
      padColumn(formatCents(activity.revenueCents), 13),
      formatCents(activity.totalCents),
    ].join(" ");
    pushWrappedLine(lines, row, { font: "F3", size: 8 });
  }

  pdfSection(lines, "Tributos");
  pushWrappedLine(lines, `${padColumn("Tributo", 14)}Valor no DAS`, { font: "F3", size: 8, color: "blue" });
  for (const tax of TAXES) {
    pushWrappedLine(lines, `${padColumn(TAX_LABELS[tax], 14)}${formatCents(value.byTaxCents[tax])}`, {
      font: "F3",
      size: 8,
    });
  }

  if (value.warnings.length > 0) {
    pdfSection(lines, "Avisos fiscais");
    for (const warning of value.warnings) {
      pushWrappedLine(lines, `- ${warning.message}`, { color: "coral" });
    }
  }

  pdfSection(lines, "Memoria de calculo");
  for (const step of value.memory) {
    pushWrappedLine(lines, `${step.label}: ${step.formula}`);
  }
  for (const activity of value.activities) {
    pushWrappedLine(lines, `Atividade: ${activity.description}`, { font: "F2", gapBefore: 4 });
    for (const step of activity.memory) {
      pushWrappedLine(lines, `${step.label}: ${step.formula}`, { indent: 10 });
    }
  }

  pushWrappedLine(lines, `Regras do Simples Nacional, versao ${value.ruleSetVersion}.`, {
    size: 8,
    gapBefore: 8,
  });

  return lines;
}

function buildPdfBlob(lines: readonly PdfTextLine[], logo: PdfLogoImage | null): Blob {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 42;
  const bottomMargin = 58;
  const topY = 728;
  const streams: string[] = [];
  let y = topY;
  let stream: string[] = [];

  const finishPage = (): void => {
    streams.push(stream.join("\n"));
    stream = [];
    y = topY;
  };

  for (const line of lines) {
    y -= line.gapBefore;
    const lineHeight = line.size + (line.role === "section" ? 6 : 4);
    if (y - lineHeight < bottomMargin) finishPage();
    if (line.role === "section") {
      stream.push(`q ${pdfStroke("coral")} 0.8 w ${marginX.toFixed(2)} ${(y - 4).toFixed(2)} m ${(pageWidth - marginX).toFixed(2)} ${(y - 4).toFixed(2)} l S Q`);
    }
    if (line.role === "total") {
      stream.push(`q ${pdfFill("navy")} ${(marginX - 6).toFixed(2)} ${(y - 6).toFixed(2)} ${(pageWidth - marginX * 2 + 12).toFixed(2)} ${(lineHeight + 7).toFixed(2)} re f Q`);
    }
    stream.push(pdfText(line.text, line.font, line.size, marginX + line.indent, y, line.color));
    y -= lineHeight;
  }
  if (stream.length > 0) finishPage();

  const logoObjectId = logo ? 6 : null;
  const firstPageId = logo ? 7 : 6;
  const pageObjectIds = streams.map((_, index) => firstPageId + index * 2);
  const objects: Uint8Array[] = [
    pdfBytes("<< /Type /Catalog /Pages 2 0 R >>"),
    pdfBytes(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${streams.length} >>`),
    pdfBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    pdfBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    pdfBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"),
  ];

  if (logo) {
    objects.push(pdfStreamObject(
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${logo.rgb.length} >>`,
      logo.rgb,
    ));
  }

  streams.forEach((bodyContent, index) => {
    const pageId = firstPageId + index * 2;
    const contentId = pageId + 1;
    const content = [
      ...pdfPageHeader(pageWidth, pageHeight, Boolean(logo)),
      bodyContent,
      ...pdfPageFooter(pageWidth, index + 1, streams.length),
    ].join("\n");
    const contentBytes = pdfBytes(content);
    const xObjects = logoObjectId ? ` /XObject << /Im1 ${logoObjectId} 0 R >>` : "";
    objects.push(pdfBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${xObjects} >> /Contents ${contentId} 0 R >>`));
    objects.push(pdfStreamObject(`<< /Length ${contentBytes.length} >>`, contentBytes));
  });

  const pdf = buildPdfFile(objects);
  const buffer = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(buffer).set(pdf);
  return new Blob([buffer], { type: "application/pdf" });
}

function pdfText(
  text: string,
  font: PdfFont,
  size: number,
  x: number,
  y: number,
  color: PdfColorName,
): string {
  return `${pdfFill(color)}\nBT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${winAnsiHex(text)} Tj ET`;
}

function pdfPageHeader(pageWidth: number, pageHeight: number, hasLogo: boolean): string[] {
  const headerHeight = 74;
  const headerBottom = pageHeight - headerHeight;
  const textX = hasLogo ? 86 : 42;
  const lines = [
    `q ${pdfFill("navy")} 0 ${headerBottom.toFixed(2)} ${pageWidth.toFixed(2)} ${headerHeight.toFixed(2)} re f Q`,
    `q ${pdfFill("coral")} 0 ${(headerBottom - 4).toFixed(2)} ${pageWidth.toFixed(2)} 4 re f Q`,
  ];

  if (hasLogo) {
    lines.push(`q 34 0 0 34 42 ${(pageHeight - 55).toFixed(2)} cm /Im1 Do Q`);
  }

  lines.push(
    pdfText("CONTALGER", "F2", 13, textX, pageHeight - 32, "white"),
    pdfText("Simulador do Simples Nacional - exercicio 2026", "F1", 8.5, textX, pageHeight - 48, "white"),
  );
  return lines;
}

function pdfPageFooter(pageWidth: number, pageNumber: number, pageCount: number): string[] {
  return [
    `q ${pdfStroke("muted")} 0.35 w 42 40 m ${(pageWidth - 42).toFixed(2)} 40 l S Q`,
    pdfText("Documento gerado localmente. Simulacao sujeita a revisao fiscal e conferencia no PGDAS-D.", "F1", 7, 42, 27, "muted"),
    pdfText(`Pagina ${pageNumber}/${pageCount}`, "F1", 7, pageWidth - 86, 27, "muted"),
  ];
}

function pdfFill(color: PdfColorName | "surface"): string {
  if (color === "surface") return "0.9020 0.9333 0.9529 rg";
  const [red, green, blue] = PDF_COLORS[color];
  return `${pdfChannel(red)} ${pdfChannel(green)} ${pdfChannel(blue)} rg`;
}

function pdfStroke(color: PdfColorName): string {
  const [red, green, blue] = PDF_COLORS[color];
  return `${pdfChannel(red)} ${pdfChannel(green)} ${pdfChannel(blue)} RG`;
}

function pdfChannel(value: number): string {
  return (value / 255).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function pdfBytes(value: string): Uint8Array {
  return PDF_ENCODER.encode(value);
}

function pdfStreamObject(dictionary: string, content: Uint8Array): Uint8Array {
  return concatPdfBytes([
    pdfBytes(`${dictionary}\nstream\n`),
    content,
    pdfBytes("\nendstream"),
  ]);
}

function buildPdfFile(objects: readonly Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [pdfBytes("%PDF-1.4\n")];
  const offsets = [0];
  let offset = parts[0].length;

  objects.forEach((body, index) => {
    const header = pdfBytes(`${index + 1} 0 obj\n`);
    const footer = pdfBytes("\nendobj\n");
    offsets[index + 1] = offset;
    parts.push(header, body, footer);
    offset += header.length + body.length + footer.length;
  });

  const startxref = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  parts.push(pdfBytes(xref));

  return concatPdfBytes(parts);
}

function concatPdfBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function loadPdfLogoImage(): Promise<PdfLogoImage | null> {
  if (!pdfLogoPromise) pdfLogoPromise = readPdfLogoImage();
  return pdfLogoPromise;
}

async function readPdfLogoImage(): Promise<PdfLogoImage | null> {
  if (typeof Image === "undefined") return null;

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = "/ctg_logo_64.png";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Nao foi possivel carregar o logo do PDF."));
    });

    const canvas = document.createElement("canvas");
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#012A48";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);

    const source = context.getImageData(0, 0, size, size).data;
    const rgb = new Uint8Array(size * size * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 4) {
      rgb[targetIndex] = source[sourceIndex];
      rgb[targetIndex + 1] = source[sourceIndex + 1];
      rgb[targetIndex + 2] = source[sourceIndex + 2];
      targetIndex += 3;
    }

    return { width: size, height: size, rgb };
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function downloadSimulationPdf(value: SimulationValue): Promise<void> {
  const logo = await loadPdfLogoImage();
  const blob = buildPdfBlob(buildPdfLines(value), logo);
  downloadBlob(blob, `simulacao-simples-nacional-${value.period}-${companySlug()}.pdf`);
}

function buildXlsxSheets(value: SimulationValue): XlsxSheet[] {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const { activityRevenue, externalRevenue, internalRevenue } = simulationRevenueSummary(value);
  const stateMode = value.sublimit.stateTaxMode === "inside-das"
    ? "ICMS/ISS dentro do DAS"
    : "ICMS/ISS fora do DAS";
  const cell = (text: string, style: XlsxStyleId = XLSX_STYLES.normal): XlsxCell =>
    style === XLSX_STYLES.normal ? text : { value: text, style };
  const titleRow = (text: string): XlsxCell[] => [cell(text, XLSX_STYLES.title)];
  const sectionRow = (text: string): XlsxCell[] => [cell(text, XLSX_STYLES.section)];
  const headerRow = (...texts: string[]): XlsxCell[] =>
    texts.map((text) => cell(text, XLSX_STYLES.tableHeader));
  const totalRow = (label: string, total: string): XlsxCell[] => [
    cell(label, XLSX_STYLES.total),
    cell(total, XLSX_STYLES.total),
  ];

  const resumo: XlsxCell[][] = [
    titleRow("Simulador Simples Nacional - Memoria de Calculo"),
    [cell("Gerado em", XLSX_STYLES.muted), generatedAt],
    [
      cell("Aviso", XLSX_STYLES.warning),
      cell("Simulacao de apoio; nao substitui PGDAS-D, legislacao vigente nem revisao fiscal.", XLSX_STYLES.note),
    ],
    [],
    sectionRow("Empresa e periodo"),
    ["Empresa", model.name.trim() || "Nao informada"],
    ["CNPJ", model.cnpj.trim() || "Nao informado"],
    ["Data de abertura", model.openingDate || "Nao informada"],
    ["Competencia", value.period],
    [],
    sectionRow("Receitas informadas"),
    ["Receita do PA - mercado interno", formatCents(internalRevenue)],
    ["Receita do PA - exportacao", formatCents(externalRevenue)],
    ["Receita total do PA", formatCents(activityRevenue)],
    [],
    sectionRow("Bases do calculo"),
    ["Meses de atividade", String(value.revenueBasis.monthsOfActivity)],
    ["RBT12 real acumulada", formatCentsText(value.revenueBasis.accumulatedRevenueCents)],
    ["RBT12 utilizada", `${formatCentsText(value.revenueBasis.rateBaseCents)} (${BASIS_LABELS[value.revenueBasis.mode]})`],
    ["Fator R", value.factorR ? formatPercentText(value.factorR, 2) : "Nao aplicado"],
    ["Regime ICMS/ISS", stateMode],
    [],
    sectionRow("Resumo do DAS"),
    totalRow("Total estimado do DAS", formatCents(value.totalDasCents)),
    ["Uniao", formatCents(value.destinations.federalCents)],
    ["Estado", formatCents(value.destinations.stateCents)],
    ["Municipio", formatCents(value.destinations.municipalCents)],
    [],
    [cell("Regras aplicadas", XLSX_STYLES.muted), `Simples Nacional, versao ${value.ruleSetVersion}`],
  ];

  const atividades: XlsxCell[][] = [
    sectionRow("Atividades"),
    headerRow("Atividade", "Anexo", "Faixa", "Aliquota efetiva", "Receita", "Total"),
    ...value.activities.map((activity) => [
      activity.description,
      activity.annex ? `Anexo ${activity.annex}` : "-",
      `Faixa ${activity.band}`,
      formatPercentText(activity.effectiveRate),
      formatCents(activity.revenueCents),
      formatCents(activity.totalCents),
    ]),
    [],
    sectionRow("Segmentos por atividade"),
    headerRow("Atividade", "Segmento", "Receita"),
    ...value.activities.flatMap((activity) =>
      activity.segments.map((segment) => [
        activity.description,
        SEGMENT_LABELS.get(segment.code) ?? segment.code,
        formatCents(segment.revenueCents),
      ]),
    ),
  ];

  const tributos: XlsxCell[][] = [
    sectionRow("Tributos"),
    headerRow("Tributo", "Valor no DAS"),
    ...TAXES.map((tax) => [TAX_LABELS[tax], formatCents(value.byTaxCents[tax])]),
    totalRow("Total do DAS", formatCents(value.totalDasCents)),
    [],
    sectionRow("Destinacao"),
    ["Uniao", formatCents(value.destinations.federalCents)],
    ["Estado", formatCents(value.destinations.stateCents)],
    ["Municipio", formatCents(value.destinations.municipalCents)],
  ];

  const memoria: XlsxCell[][] = [
    sectionRow("Memoria de calculo"),
    headerRow("Escopo", "Etapa", "Formula"),
    ...value.memory.map((step) => memoryRow("Geral", step)),
    ...value.activities.flatMap((activity) =>
      activity.memory.map((step) => memoryRow(activity.description, step)),
    ),
    [],
    sectionRow("Avisos fiscais"),
    ...value.warnings.map((warning) => [cell(warning.message, XLSX_STYLES.warning)]),
  ];
  const segmentosSectionRow = value.activities.length + 4;
  const destinacaoSectionRow = TAXES.length + 5;
  const memoryRowsCount = value.memory.length + value.activities.reduce(
    (sum, activity) => sum + activity.memory.length,
    0,
  );
  const avisosSectionRow = memoryRowsCount + 4;

  return [
    {
      name: "Resumo",
      rows: resumo,
      columns: [32, 68],
      merges: ["A1:B1", "A5:B5", "A11:B11", "A16:B16", "A23:B23"],
    },
    {
      name: "Atividades",
      rows: atividades,
      columns: [36, 14, 12, 18, 18, 18],
      merges: ["A1:F1", `A${segmentosSectionRow}:F${segmentosSectionRow}`],
    },
    {
      name: "Tributos",
      rows: tributos,
      columns: [30, 20],
      merges: ["A1:B1", `A${destinacaoSectionRow}:B${destinacaoSectionRow}`],
    },
    {
      name: "Memoria",
      rows: memoria,
      columns: [24, 30, 74],
      merges: ["A1:C1", `A${avisosSectionRow}:C${avisosSectionRow}`],
    },
  ];
}

function memoryRow(scope: string, step: SimulationValue["memory"][number]): string[] {
  // So o metodo. Entradas cruas (chaves internas, centavos, decimais longos) e o
  // resultado interno ficam de fora para nao vazar detalhe de backend.
  return [scope, step.label, step.formula];
}

function downloadSimulationXlsx(value: SimulationValue): void {
  const blob = buildXlsxBlob(buildXlsxSheets(value));
  downloadBlob(blob, `simulacao-simples-nacional-${value.period}-${companySlug()}.xlsx`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function taxRows(byTax: Readonly<Record<Tax, number>>, total: number): string {
  const rows = TAXES.map((tax) => {
    const value = byTax[tax];
    return `<tr>
      <td>${TAX_LABELS[tax]}</td>
      <td class="${value === 0 ? "muted" : ""}">${formatCents(value)}</td>
    </tr>`;
  }).join("");
  return `<table class="result-table">
    <thead><tr><th>Tributo</th><th>Valor no DAS</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total do DAS</td><td>${formatCents(total)}</td></tr></tfoot>
  </table>`;
}

function activityRows(value: SimulationValue): string {
  const rows = value.activities.map((activity) => `<tr>
    <td>${escapeHtml(activity.description)}</td>
    <td>${activity.annex ? `Anexo ${activity.annex}` : "-"}</td>
    <td>${activity.effectiveRate ? `Faixa ${activity.band}` : "-"}</td>
    <td>${formatPercentText(activity.effectiveRate)}</td>
    <td>${formatCents(activity.totalCents)}</td>
  </tr>`).join("");
  return `<table class="result-table">
    <thead><tr><th>Atividade</th><th>Anexo</th><th>Faixa</th><th>Alíq. efetiva</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function basisPanel(value: SimulationValue): string {
  const basis = value.revenueBasis;
  const monthsText = basis.mode === "first-period-proportionalized"
    ? "1 — primeiro mês (base = receita do PA × 12)"
    : basis.mode === "startup-proportionalized"
      ? `${basis.monthsOfActivity} — menos de 12 meses (base proporcionalizada)`
      : "12 — empresa com 12 meses ou mais (RBT12 real)";

  const band = value.activities[0]?.band ?? null;
  const suggested = value.activities
    .find((activity) => activity.annexSuggestedByFactorR)?.annexSuggestedByFactorR ?? null;
  const factorRRow = value.factorR
    ? `<tr><td>Fator R</td><td>${formatPercentText(value.factorR, 2)}${suggested ? ` &rarr; enquadramento sugerido: Anexo ${suggested}` : ""}</td></tr>`
    : "";

  return `<div class="panel">
    <h2 class="panel__title">Bases do cálculo</h2>
    <table class="result-table result-table--kv">
      <tbody>
        <tr><td>Meses de atividade</td><td>${monthsText}</td></tr>
        <tr><td>RBT12 real acumulada</td><td>${formatCentsText(basis.accumulatedRevenueCents)}</td></tr>
        <tr><td>RBT12 utilizada no cálculo</td><td>${formatCentsText(basis.rateBaseCents)} <span class="muted">(${BASIS_LABELS[basis.mode]})</span></td></tr>
        ${factorRRow}
        ${band !== null ? `<tr><td>Faixa (igual para todas as atividades)</td><td>Faixa ${band}</td></tr>` : ""}
      </tbody>
    </table>
  </div>`;
}

function memorySteps(steps: SimulationValue["memory"]): string {
  // So o metodo (rotulo + formula). Os valores ja aparecem formatados nos
  // paineis acima; despejar as entradas cruas (chaves internas, centavos e
  // decimais de 30 digitos) vazaria detalhe de backend.
  return steps.map((step) => `<div class="memory__step">
      <div class="memory__label">${escapeHtml(step.label)}</div>
      <p class="memory__formula">${escapeHtml(step.formula)}</p>
    </div>`).join("");
}

function renderResult(value: SimulationValue): void {
  latestSimulation = value;
  const warnings = value.warnings.map((warning) =>
    `<div class="notice notice--warn">${escapeHtml(warning.message)}</div>`,
  ).join("");

  const activityMemory = value.activities.map((activity) =>
    `<p class="activity-memory__name">${escapeHtml(activity.description)}</p>${memorySteps(activity.memory)}`,
  ).join("");

  const stateMode = value.sublimit.stateTaxMode === "inside-das"
    ? "ICMS/ISS dentro do DAS"
    : "ICMS/ISS fora do DAS";

  resultRoot.innerHTML = `
    <div class="headline">
      <p class="headline__label">Total estimado do DAS</p>
      <p class="headline__value">${formatCents(value.totalDasCents)}</p>
      <div class="headline__meta">
        <span>Competência <strong>${escapeHtml(value.period)}</strong></span>
        <span>${stateMode}</span>
      </div>
      <div class="result__downloads">
        <button class="btn btn--light" type="button" id="download-pdf">Baixar PDF</button>
        <button class="btn btn--light" type="button" id="download-xlsx">Baixar Excel</button>
      </div>
    </div>

    ${basisPanel(value)}

    <div class="panel">
      <h2 class="panel__title">Por atividade</h2>
      <div class="table-scroll">${activityRows(value)}</div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Tributos</h2>
      ${taxRows(value.byTaxCents, value.totalDasCents)}
    </div>

    <div class="panel">
      <h2 class="panel__title">Destinação</h2>
      <div class="destinations">
        <div class="destination"><span>União</span><strong>${formatCents(value.destinations.federalCents)}</strong></div>
        <div class="destination"><span>Estado</span><strong>${formatCents(value.destinations.stateCents)}</strong></div>
        <div class="destination"><span>Município</span><strong>${formatCents(value.destinations.municipalCents)}</strong></div>
      </div>
    </div>

    ${warnings ? `<div class="panel"><h2 class="panel__title">Avisos fiscais</h2>${warnings}</div>` : ""}

    <div class="panel">
      <h2 class="panel__title">Memória de cálculo</h2>
      ${memorySteps(value.memory)}
      ${activityMemory}
    </div>

    <div class="panel">
      <p class="block__hint">Regras do Simples Nacional, versão ${escapeHtml(value.ruleSetVersion)}. Simulação de apoio sujeita à revisão humana e à comparação com o PGDAS-D.</p>
    </div>`;
}

function markMoneyErrors(keys: readonly string[]): void {
  for (const input of document.querySelectorAll<HTMLInputElement>(".field__input--invalid")) {
    input.classList.remove("field__input--invalid");
  }
  for (const key of keys) {
    const input = document.querySelector<HTMLInputElement>(`[data-money-key="${CSS.escape(key)}"]`);
    input?.classList.add("field__input--invalid");
  }
}

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

function currentPlan() {
  if (!model.rulePeriod || !model.openingDate) return null;
  const plan = planHistory(model.rulePeriod, model.openingDate);
  return plan;
}

function renderDynamic(): void {
  const plan = currentPlan();

  if (!plan) {
    periodHint.textContent = "";
    updateAdvancedFields(false, false);
    renderHistory(null);
    renderActivities();
    return;
  }
  if (!plan.ok) {
    periodHint.textContent = plan.error;
    updateAdvancedFields(false, false);
    renderHistory(null);
    renderActivities();
    return;
  }

  const months = plan.value.monthsBeforePeriod;
  periodHint.textContent = months === 0
    ? "Primeiro mês de atividade."
    : months <= 11
      ? `${months} mês(es) de atividade antes do PA: base proporcionalizada.`
      : "Empresa estabelecida: RBT12 pelos 12 meses anteriores.";

  updateAdvancedFields(plan.value.startupYear, quickHistoryEnabled(plan.value));
  renderHistory(plan.value);
  renderActivities();
}

function recompute(): void {
  const plan = currentPlan();

  if (!plan) {
    markMoneyErrors([]);
    renderEmpty("Informe a data de abertura e a competência para iniciar a simulação.");
    return;
  }
  if (!plan.ok) {
    markMoneyErrors([]);
    renderErrors([{ code: "PERIOD", path: "empresa/período", message: plan.error }]);
    return;
  }

  const { input, moneyErrors, inputErrors } = buildSimulation(plan.value);
  markMoneyErrors(moneyErrors);
  if (moneyErrors.length > 0) {
    renderErrors([{
      code: "INVALID_MONEY",
      path: "valores monetários",
      message: "Há valores monetários inválidos, marcados em vermelho.",
    }]);
    return;
  }
  if (inputErrors.length > 0) {
    renderErrors(inputErrors);
    return;
  }

  const result = simulate(input);
  if (!result.ok) {
    renderErrors(result.errors);
    return;
  }
  renderResult(result.value);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isFormControl(target: EventTarget | null): target is FormControl {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
}

function updateModelFromField(field: FormControl): void {
  const data = field.dataset;

  if (data.field) {
    const key = data.field as keyof FormModel;
    if (key === "impeded") {
      model.impeded = (field as HTMLInputElement).checked;
    } else if (key === "historyMode") {
      model.historyMode = field.value as FormModel["historyMode"];
    } else if (key === "firstPeriodPayroll") {
      model.firstPeriodPayroll = field.value;
    } else if (
      key === "name" || key === "cnpj" || key === "openingDate"
      || key === "rulePeriod" || key === "rbt12Internal" || key === "rbt12External"
      || key === "fs12Total" || key === "priorInternal" || key === "priorExternal"
      || key === "currentYearInternalBefore" || key === "currentYearExternalBefore"
    ) {
      model[key] = field.value;
    }
    return;
  }

  if (data.histPeriod && data.histKind) {
    const cell = model.history[data.histPeriod] ?? { internal: "", external: "", payroll: "" };
    cell[data.histKind as keyof HistoryCell] = field.value;
    model.history[data.histPeriod] = cell;
    return;
  }

  if (data.actIndex !== undefined) {
    const activity = model.activities[Number(data.actIndex)];
    if (!activity) return;
    if (data.seg) {
      activity.segments[data.seg as RevenueSegmentCode] = field.value;
    } else if (data.actfield === "annexMode") {
      activity.annexMode = field.value as ActivityModel["annexMode"];
    } else if (data.actfield === "selectedAnnex") {
      activity.selectedAnnex = field.value as Annex | "";
    } else if (data.actfield === "overrideAnnex") {
      activity.overrideAnnex = field.value as Annex | "";
    } else if (data.actfield === "confirmOverride") {
      activity.confirmOverride = (field as HTMLInputElement).checked;
    } else if (data.actfield === "description") {
      activity.description = field.value;
    }
  }
}

const form = el<HTMLFormElement>("form");

function applyNumericMask(
  input: HTMLInputElement,
  formatter: (value: string) => string,
): void {
  const caret = input.selectionStart ?? input.value.length;
  const result = formatNumericInputWithCaret(input.value, caret, formatter);
  input.value = result.formatted;
  input.setSelectionRange(result.caretIndex, result.caretIndex);
}

form.addEventListener("input", (event) => {
  const target = event.target;
  if (!isFormControl(target)) return;
  if (target.dataset.structural !== undefined) return;
  if (target instanceof HTMLInputElement && target.dataset.field === "cnpj") {
    applyNumericMask(target, formatCnpjInput);
  }
  if (target instanceof HTMLInputElement && target.dataset.money !== undefined) {
    applyNumericMask(target, formatMoneyInput);
  }
  updateModelFromField(target);
  recompute();
});

form.addEventListener("change", (event) => {
  const target = event.target;
  if (!isFormControl(target)) return;
  updateModelFromField(target);
  if (target.dataset.structural !== undefined) {
    renderDynamic();
  }
  recompute();
});

form.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const removeIndex = target.dataset.removeIndex;
  if (removeIndex !== undefined) {
    model.activities.splice(Number(removeIndex), 1);
    renderDynamic();
    recompute();
    return;
  }

  if (target.id === "add-activity") {
    model.activities.push(emptyActivity());
    renderDynamic();
    recompute();
    return;
  }

  if (target.id === "reset") {
    model = defaultModel();
    syncStaticFields();
    renderDynamic();
    recompute();
    return;
  }

  if (target.id === "load-example") {
    const hasData = model.openingDate !== "" || model.rbt12Internal !== ""
      || model.activities.some((a) => Object.values(a.segments).some((v) => (v ?? "") !== ""));
    if (hasData && !confirm("Isto substitui os dados preenchidos pelo exemplo da planilha. Continuar?")) {
      return;
    }
    model = exampleModel();
    syncStaticFields();
    renderDynamic();
    recompute();
    return;
  }

});

resultRoot.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === "download-pdf" && latestSimulation) {
    void downloadSimulationPdf(latestSimulation);
  }
  if (target.id === "download-xlsx" && latestSimulation) {
    downloadSimulationXlsx(latestSimulation);
  }
});

// ---------------------------------------------------------------------------
// Campos estaticos
// ---------------------------------------------------------------------------

function syncStaticFields(): void {
  for (const field of form.querySelectorAll<FormControl>("[data-field]")) {
    const key = field.dataset.field as keyof FormModel;
    if (key === "impeded") {
      (field as HTMLInputElement).checked = model.impeded;
    } else if (key === "historyMode" && field instanceof HTMLInputElement && field.type === "radio") {
      field.checked = field.value === model.historyMode;
    } else if (typeof model[key] === "string") {
      field.value = model[key] as string;
    }
  }
}

// ---------------------------------------------------------------------------
// Painel de instrucoes
// ---------------------------------------------------------------------------

const INSTRUCTIONS_HTML = `
  <h3>O que é este simulador</h3>
  <p>
    Estima o DAS mensal do Simples Nacional para o ano-calendário de 2026, com
    as tabelas da LC 123/2006 e da Resolução CGSN 140/2018 (vigentes até
    31/12/2026). Reproduz a lógica da planilha de referência da CTG e apresenta
    a memória de cálculo completa, aberta por atividade, segmento, tributo e
    ente federativo.
  </p>

  <h3>Passo a passo</h3>
  <ol>
    <li><strong>Empresa e período:</strong> informe a data de abertura e a
      competência (o mês apurado, sempre de 2026). A partir dessas datas o
      simulador calcula sozinho quantos meses de histórico pedir.</li>
    <li><strong>Base RBT12:</strong> para empresa com 12 meses ou mais, use o
      modo rápido e informe a RBT12 como na planilha. Para abertura recente ou
      conferência de sublimite, alterne para histórico mensal.</li>
    <li><strong>Fator R (opcional):</strong> para atividades de serviço sujeitas
      ao Fator R, informe a folha de salários. O simulador sugere Anexo III ou V
      automaticamente.</li>
    <li><strong>Atividades e segmentos:</strong> em cada atividade escolha o
      Anexo (manual) ou o Fator R, e distribua a receita do mês pelos segmentos.
      A soma dos segmentos vira a receita da atividade automaticamente.</li>
    <li><strong>Resultado:</strong> o painel mostra o Total do DAS, os tributos,
      a destinação por ente, os avisos e a memória de cálculo. Quando estiver
      válido, os botões Baixar PDF e Baixar Excel geram a memória local da
      simulação atual.</li>
  </ol>

  <h3>A lógica por trás dos cálculos</h3>
  <ul>
    <li><strong>RBT12 e proporcionalização:</strong> a faixa e a alíquota usam a
      receita dos 12 meses anteriores. Se a empresa tem menos de 12 meses, o
      simulador proporcionaliza (receita dos meses anteriores ÷ meses × 12);
      no primeiro mês, usa a receita do próprio PA × 12.</li>
    <li><strong>Alíquota efetiva:</strong>
      (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12. Quando a RBT12 é
      zero, a Receita usa R$ 1,00 apenas para achar a alíquota (nunca zera o
      resultado).</li>
    <li><strong>Fator R (Anexo III × V):</strong> folha de 12 meses ÷ RBT12. Se
      ≥ 28%, a atividade de serviço vai para o Anexo III; abaixo disso, para o
      Anexo V.</li>
    <li><strong>Segregação da receita:</strong> o valor de cada tributo é
      alíquota efetiva × percentual de repartição do Anexo/faixa × a receita do
      segmento em que aquele tributo incide. Receita monofásica dispensa
      PIS/COFINS; ICMS-ST dispensa o ICMS; isenta/imune e ISS retido saem do
      tributo correspondente; exportação sai de ICMS, ISS, PIS, COFINS e IPI.</li>
    <li><strong>Teto de 5% do ISS:</strong> quando o ISS efetivo passa de 5%
      (Anexos III/IV nas faixas altas), o simulador limita o ISS a 5% e
      redistribui o excedente aos tributos federais. Se o ISS é retido pelo
      tomador, não há ISS no DAS nem redistribuição.</li>
    <li><strong>Sublimite de ICMS/ISS (R$ 3,6 milhões em 2026):</strong> acima
      dele, o ICMS e o ISS deixam o DAS e passam a ser pagos por fora ao
      Estado/Município, seguindo as razões do art. 24 da Resolução CGSN
      140/2018. Por isso as bases de RBAA e ano atual ficam em área avançada:
      em cenário comum abaixo do sublimite, podem ficar zeradas.</li>
    <li><strong>Destinação:</strong> União = IRPJ + CSLL + COFINS + PIS + CPP +
      IPI; Estado = ICMS; Município = ISS.</li>
  </ul>

  <p class="note">
    <strong>Aviso:</strong> ferramenta de simulação e apoio à decisão. Não
    substitui a apuração oficial no PGDAS-D nem a orientação de um contador,
    especialmente em sublimites, retenções, regras de faixa 5/6 e enquadramento
    de atividades. As tabelas valem até 31/12/2026; a partir de 2027 a Reforma
    Tributária (LC 214/2025) exigirá novas tabelas.
  </p>
`;

function setupInstructions(): void {
  const modal = el<HTMLDivElement>("instructions-modal");
  const body = el<HTMLDivElement>("instructions-body");
  body.innerHTML = INSTRUCTIONS_HTML;

  const open = (): void => {
    modal.hidden = false;
    el<HTMLButtonElement>("close-instructions").focus();
  };
  const close = (): void => {
    modal.hidden = true;
    el<HTMLButtonElement>("open-instructions").focus();
  };

  el<HTMLButtonElement>("open-instructions").addEventListener("click", open);
  el<HTMLButtonElement>("close-instructions").addEventListener("click", close);
  for (const backdrop of modal.querySelectorAll("[data-close-instructions]")) {
    backdrop.addEventListener("click", close);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });
}

// Gera as competencias do seletor a partir da vigencia do conjunto de regras
// carregado (nao do relogio do sistema): hoje, 2026-01 a 2026-12.
function populatePeriodOptions(): void {
  const select = form.querySelector<HTMLSelectElement>('[data-field="rulePeriod"]');
  if (!select) return;

  const [fromYear, fromMonth] = RULESET_2026.period.from.split("-").map(Number);
  const [throughYear, throughMonth] = RULESET_2026.period.through.split("-").map(Number);
  const fromIndex = fromYear * 12 + (fromMonth - 1);
  const throughIndex = throughYear * 12 + (throughMonth - 1);

  const options: string[] = [];
  for (let index = fromIndex; index <= throughIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const value = `${year}-${String(month + 1).padStart(2, "0")}`;
    options.push(`<option value="${value}">${MONTH_NAMES_PT[month]} / ${year}</option>`);
  }
  select.innerHTML = options.join("");
  select.value = model.rulePeriod;
}

// Tema claro/escuro. So preferencia de UI; persistida por navegador (nao ha
// dado fiscal envolvido). O tema inicial ja e definido pelo script inline do
// <head> (evita piscar); aqui so sincronizamos o rotulo e ligamos o botao.
function setupTheme(): void {
  const root = document.documentElement;
  const button = el<HTMLButtonElement>("toggle-theme");

  const saveTheme = (theme: string): void => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* modo privado: sem persistir */
    }
  };
  const syncLabel = (theme: string): void => {
    button.setAttribute("aria-label", theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro");
  };

  const current = root.dataset.theme === "dark" ? "dark" : "light";
  root.dataset.theme = current;
  syncLabel(current);

  button.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    saveTheme(next);
    syncLabel(next);
    // Reinicia o brilho ("acender") mesmo em cliques seguidos.
    button.classList.remove("is-switching");
    void button.offsetWidth;
    button.classList.add("is-switching");
  });
}

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------

rulesetBadge.textContent = `Regras ${RULESET_2026.version} · vigência 2026`;
setupTheme();
setupInstructions();
populatePeriodOptions();
syncStaticFields();
renderDynamic();
recompute();
