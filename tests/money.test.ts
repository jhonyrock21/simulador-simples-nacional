import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatCnpjInput,
  formatMoneyInput,
  formatNumericInputWithCaret,
  formatPercentText,
  parseMoneyToCents,
} from "../src/money";

describe("parseMoneyToCents", () => {
  it("le formatos pt-BR com milhar e decimal", () => {
    expect(parseMoneyToCents("1.522.284,18")).toBe(152_228_418);
    expect(parseMoneyToCents("179.361,40")).toBe(17_936_140);
    expect(parseMoneyToCents("0,00")).toBe(0);
    expect(parseMoneyToCents("1234,5")).toBe(123_450);
    expect(parseMoneyToCents(",5")).toBe(50);
  });

  it("trata ponto isolado como milhar, nunca como decimal indevido", () => {
    expect(parseMoneyToCents("1.000")).toBe(100_000);
    expect(parseMoneyToCents("1.000.000")).toBe(100_000_000);
    expect(parseMoneyToCents("1234")).toBe(123_400);
  });

  it("aceita ponto como decimal quando ha ate dois digitos finais", () => {
    expect(parseMoneyToCents("1000.50")).toBe(100_050);
    expect(parseMoneyToCents("1,234.56")).toBe(123_456);
  });

  it("considera texto vazio como zero e ignora R$ e espacos", () => {
    expect(parseMoneyToCents("")).toBe(0);
    expect(parseMoneyToCents("   ")).toBe(0);
    expect(parseMoneyToCents("R$ 10,00")).toBe(1_000);
  });

  it("rejeita valores invalidos e negativos", () => {
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5,00")).toBeNull();
    expect(parseMoneyToCents("10,00,00")).toBeNull();
  });
});

describe("formatMoneyInput (mascara acumuladora de centavos)", () => {
  it("desloca cada digito para a direita como centavos", () => {
    expect(formatMoneyInput("5")).toBe("0,05");
    expect(formatMoneyInput("55")).toBe("0,55");
    expect(formatMoneyInput("5505555")).toBe("55.055,55");
    expect(formatMoneyInput("550555500")).toBe("5.505.555,00");
  });

  it("ignora caracteres nao numericos e o proprio texto ja formatado", () => {
    expect(formatMoneyInput("R$ 55.055,55")).toBe("55.055,55");
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("abc")).toBe("");
  });

  it("o texto formatado reconverte para os mesmos centavos", () => {
    expect(parseMoneyToCents(formatMoneyInput("5505555"))).toBe(5_505_555);
    expect(parseMoneyToCents(formatMoneyInput("550555500"))).toBe(550_555_500);
  });
});

describe("formatacao", () => {
  it("formata centavos em BRL", () => {
    expect(formatCents(2_979_404)).toContain("29.794,04");
    expect(formatCents(2_979_404).startsWith("R$")).toBe(true);
    expect(formatCents(0)).toContain("0,00");
  });

  it("formata aliquotas e trata nulo", () => {
    expect(formatPercentText("0.17510", 4)).toBe("17.5100%");
    expect(formatPercentText(null)).toBe("-");
  });
});

describe("formatCnpjInput", () => {
  it("formata progressivamente como CNPJ brasileiro", () => {
    expect(formatCnpjInput("6")).toBe("6");
    expect(formatCnpjInput("60")).toBe("60");
    expect(formatCnpjInput("608")).toBe("60.8");
    expect(formatCnpjInput("60800456")).toBe("60.800.456");
    expect(formatCnpjInput("60800456000168")).toBe("60.800.456/0001-68");
  });

  it("ignora pontuacao existente e limita em 14 digitos", () => {
    expect(formatCnpjInput("60.800.456/0001-68")).toBe("60.800.456/0001-68");
    expect(formatCnpjInput("60.800.456/0001-68000")).toBe("60.800.456/0001-68");
    expect(formatCnpjInput("abc")).toBe("");
  });
});

describe("formatNumericInputWithCaret", () => {
  it("mantem o cursor no fim durante digitacao normal de dinheiro", () => {
    expect(formatNumericInputWithCaret("5", 1, formatMoneyInput)).toEqual({
      formatted: "0,05",
      caretIndex: 4,
    });
  });

  it("preserva o ponto de edicao ao apagar digito no meio de dinheiro", () => {
    expect(formatNumericInputWithCaret("5.55,55", 3, formatMoneyInput)).toEqual({
      formatted: "555,55",
      caretIndex: 2,
    });
  });

  it("preserva o ponto de edicao ao apagar digito no meio de CNPJ", () => {
    expect(formatNumericInputWithCaret("60.80.456/0001-68", 5, formatCnpjInput)).toEqual({
      formatted: "60.804.560/0016-8",
      caretIndex: 5,
    });
  });
});
