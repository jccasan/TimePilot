import { useQuery } from "@tanstack/react-query";

type CompanyLocale = {
  country?: string;
};

export function useAddressLabels() {
  const { data: company } = useQuery<CompanyLocale>({
    queryKey: ["/api/company"],
  });

  const country = (company?.country || "us").toLowerCase();

  return {
    stateLabel: country === "ca" ? "Province" : "State",
    zipLabel: country === "ca" ? "Postal Code" : "Zip Code",
    country,
  };
}
