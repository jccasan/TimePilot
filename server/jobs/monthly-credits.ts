import { storage } from "../storage";
import { TIER_CONFIG } from "@shared/schema";

export async function runMonthlyCreditReplenishment() {
  const now = new Date();
  if (now.getDate() !== 1) return;

  console.log(
    "[monthly-credits] 1st of month — replenishing optimizer credits for all active companies"
  );

  const allCompanies = await storage.getAllCompanies();
  let replenished = 0;
  let errors = 0;

  for (const company of allCompanies) {
    try {
      if (company.demoUnlimitedCredits) continue;
      if (company.subscriptionStatus === "cancelled") continue;

      const tier = (company.subscriptionTier ?? "tier_1") as keyof typeof TIER_CONFIG;
      const monthlyAllowance = TIER_CONFIG[tier]?.monthlyOptimizerCredits ?? 20;

      await storage.updateCompany(company.id, { routeCredits: monthlyAllowance });
      replenished++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[monthly-credits] Error replenishing company ${company.id}:`, message);
      errors++;
    }
  }

  console.log(`[monthly-credits] Done — replenished ${replenished} companies, ${errors} errors`);
}
