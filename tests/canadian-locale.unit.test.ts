import { describe, it, expect } from "vitest";
import { formatMoneyForCurrency } from "../client/src/hooks/use-currency";

describe("formatMoneyForCurrency — Canadian vs US display", () => {
  it("formats USD amounts with $ prefix", () => {
    expect(formatMoneyForCurrency(0, "usd")).toBe("$0.00");
    expect(formatMoneyForCurrency(50, "usd")).toBe("$50.00");
    expect(formatMoneyForCurrency(1234.56, "usd")).toBe("$1,234.56");
  });

  it("formats CAD amounts with CA$ prefix (not bare $)", () => {
    expect(formatMoneyForCurrency(0, "cad")).toBe("CA$0.00");
    expect(formatMoneyForCurrency(50, "cad")).toBe("CA$50.00");
    expect(formatMoneyForCurrency(1234.56, "cad")).toBe("CA$1,234.56");
  });

  it("CA$ and $ are visually distinct so users can tell currencies apart", () => {
    const usd = formatMoneyForCurrency(50, "usd");
    const cad = formatMoneyForCurrency(50, "cad");
    expect(usd).not.toBe(cad);
    expect(cad).toContain("CA$");
    expect(usd).not.toContain("CA$");
  });

  it("is case-insensitive for the currency code", () => {
    expect(formatMoneyForCurrency(100, "CAD")).toBe("CA$100.00");
    expect(formatMoneyForCurrency(100, "USD")).toBe("$100.00");
  });

  it("rounds correctly to two decimal places", () => {
    expect(formatMoneyForCurrency(0.1 + 0.2, "usd")).toBe("$0.30");
    expect(formatMoneyForCurrency(0.1 + 0.2, "cad")).toBe("CA$0.30");
  });
});
