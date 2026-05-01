import { useQuery } from "@tanstack/react-query";

type CompanyLocale = {
  currency?: string;
};

export function currencyLocale(currency: string): string {
  return currency.toLowerCase() === "cad" ? "en-CA" : "en-US";
}

export function formatMoneyForCurrency(amount: number, currency: string): string {
  const cur = currency.toLowerCase();
  const locale = currencyLocale(cur);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur.toUpperCase(),
  }).format(amount);
}

export function useCurrency() {
  const { data: company } = useQuery<CompanyLocale>({
    queryKey: ["/api/company"],
  });

  const currency = (company?.currency || "usd").toLowerCase();
  const locale = currencyLocale(currency);

  const formatMoney = (amount: number): string => formatMoneyForCurrency(amount, currency);

  return { formatMoney, currency, locale };
}
