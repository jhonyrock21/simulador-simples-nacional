// Helpers puros de dinheiro/percentual usados pela interface. Sem DOM, para
// permitir teste direto em Node. Valores monetarios trafegam sempre em centavos
// inteiros; o motor (`calc.ts`) continua sendo a autoridade do calculo.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DECIMAL_BRL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/**
 * Mascara de moeda "acumuladora de centavos": cada digito digitado entra pela
 * direita, de modo que digitar 5505555 vira "55.055,55" (e nunca R$ 5.505.555).
 * Remove a ambiguidade de interpretar um numero solto como reais ou centavos.
 * Texto sem digitos vira string vazia.
 */
export function formatMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 15);
  if (digits === "") return "";
  return DECIMAL_BRL.format(Number(digits) / 100);
}

export function formatCnpjInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function formatNumericInputWithCaret(
  raw: string,
  caretIndex: number,
  formatter: (value: string) => string,
): { formatted: string; caretIndex: number } {
  const boundedCaret = Math.max(0, Math.min(caretIndex, raw.length));
  const rawDigits = raw.replace(/\D/g, "");
  const digitsBeforeCaret = raw.slice(0, boundedCaret).replace(/\D/g, "").length;
  const formatted = formatter(raw);
  const formattedDigitCount = formatted.replace(/\D/g, "").length;

  // Money inputs such as "5" format to "0,05"; those leading zeroes were not
  // typed by the user, so the caret must be mapped after them.
  const generatedLeadingDigits = Math.max(
    0,
    formattedDigitCount - Math.min(rawDigits.length, formattedDigitCount),
  );
  const targetDigitCount = Math.min(
    formattedDigitCount,
    generatedLeadingDigits + digitsBeforeCaret,
  );

  return {
    formatted,
    caretIndex: caretAfterDigitCount(formatted, targetDigitCount),
  };
}

function caretAfterDigitCount(value: string, digitCount: number): number {
  if (digitCount <= 0) return 0;

  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      seen += 1;
      if (seen === digitCount) return index + 1;
    }
  }
  return value.length;
}

export function formatCentsText(centsText: string): string {
  const value = Number(centsText);
  return Number.isFinite(value) ? BRL.format(value / 100) : centsText;
}

export function formatPercentText(rate: string | null, decimals = 4): string {
  if (rate === null) return "-";
  const value = Number(rate);
  return Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : rate;
}

/**
 * Converte um texto em pt-BR (ou US) para centavos inteiros nao negativos.
 *
 * O ultimo separador seguido de 1 ou 2 digitos e tratado como decimal; qualquer
 * outro ponto/virgula e separador de milhar. Assim "1.522.284,18", "1234,5",
 * "1000.50" e "1.000" (mil) sao lidos sem o erro silencioso de 100x. Texto vazio
 * vale zero; qualquer caractere invalido (inclusive sinal negativo) retorna null.
 */
export function parseMoneyToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;

  const cleaned = trimmed.replace(/[R$\s]/g, "");
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  // Em pt-BR a virgula e somente separador decimal, entao mais de uma virgula e
  // entrada malformada (ex.: "10,00,00").
  if ((cleaned.match(/,/g) ?? []).length > 1) return null;

  const lastSeparator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  let integerText = cleaned;
  let decimalText = "";

  if (lastSeparator >= 0) {
    const afterSeparator = cleaned.slice(lastSeparator + 1);
    if (/^\d{1,2}$/.test(afterSeparator)) {
      integerText = cleaned.slice(0, lastSeparator);
      decimalText = afterSeparator;
    }
  }

  integerText = integerText.replace(/[.,]/g, "");
  if (integerText === "") integerText = "0";
  if (!/^\d+$/.test(integerText)) return null;

  const cents = Number(integerText) * 100 + Number(decimalText.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
