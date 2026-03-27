import { useQuery } from "@tanstack/react-query";

interface CompanyTimezone {
  timezone: string;
}

export function useCompanyTimezone(): string {
  const { data } = useQuery<CompanyTimezone>({
    queryKey: ["/api/company"],
  });
  return data?.timezone || "America/New_York";
}
