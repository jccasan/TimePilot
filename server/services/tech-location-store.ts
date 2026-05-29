export type TechLocationEntry = {
  userId: string;
  companyId: string;
  firstName: string;
  lastName: string;
  lat: number | null;
  lng: number | null;
  gpsPermission: "granted" | "denied" | "unavailable";
  updatedAt: string;
};

const store = new Map<string, TechLocationEntry>();

export function upsertTechLocation(
  entry: Omit<TechLocationEntry, "updatedAt">
): void {
  store.set(entry.userId, { ...entry, updatedAt: new Date().toISOString() });
}

export function getTechLocationsForCompany(companyId: string): TechLocationEntry[] {
  return Array.from(store.values()).filter((e) => e.companyId === companyId);
}
