import { createContext, useContext } from "react";

interface AdminCrmContextValue {
  crmPath: string;
  setCrmPath: (path: string) => void;
}

export const AdminCrmContext = createContext<AdminCrmContextValue>({
  crmPath: "/",
  setCrmPath: () => {},
});

export function useAdminCrm() {
  return useContext(AdminCrmContext);
}
