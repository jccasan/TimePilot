import { storage } from "../storage";

export async function runStopOrderRepair(): Promise<void> {
  console.log("[stop-order-repair] Starting nightly stop order integrity check");

  let companies: Awaited<ReturnType<typeof storage.getAllCompanies>>;
  try {
    companies = await storage.getAllCompanies();
  } catch (err) {
    console.error("[stop-order-repair] Failed to fetch companies:", err);
    return;
  }

  let totalRoutes = 0;
  let repairedRoutes = 0;
  let errors = 0;

  for (const company of companies) {
    let routes: Awaited<ReturnType<typeof storage.getRoutes>>;
    try {
      routes = await storage.getRoutes(company.id);
    } catch (err) {
      console.error(`[stop-order-repair] Failed to fetch routes for company ${company.id}:`, err);
      errors++;
      continue;
    }

    for (const route of routes) {
      totalRoutes++;
      try {
        await storage.renumberRouteStops(route.id, company.id);
        repairedRoutes++;
      } catch (err) {
        console.error(
          `[stop-order-repair] Failed to renumber stops for route ${route.id} (company ${company.id}):`,
          err
        );
        errors++;
      }
    }
  }

  console.log(
    `[stop-order-repair] Done — checked ${totalRoutes} routes across ${companies.length} companies, ` +
      `repaired ${repairedRoutes}, errors ${errors}`
  );
}
