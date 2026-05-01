import { useQuery } from "@tanstack/react-query";

type CompanyLocale = {
  currency?: string;
};

/**
 * Format a monetary amount using the given currency code.
 *
 * We use `en-US` as the display locale for all currencies intentionally:
 * - USD + en-US → "$X.XX"  (domestic symbol)
 * - CAD + en-US → "CA$X.XX" (Intl adds the country prefix for foreign currencies)
 *
 * Using `en-CA` + CAD would show bare "$X.XX" (indistinguishable from USD),
 * because ICU treats CAD as the domestic currency in the `en-CA` locale.
 */
export function formatMoneyForCurrency(amount: number, currency: string): string {
  const cur = currency.toLowerCase();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur.toUpperCase(),
  }).format(amount);
}

export function useCurrency() {
  const { data: company } = useQuery<CompanyLocale>({
    queryKey: ["/api/company"],
  });

  const currency = (company?.currency || "usd").toLowerCase();

  const formatMoney = (amount: number): string => formatMoneyForCurrency(amount, currency);

  return { formatMoney, currency };
}
