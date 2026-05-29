import { useQuery } from "@tanstack/react-query";
import GrowthScorecard from "@/components/calculators/GrowthScorecard";
import WhenToHire from "@/components/calculators/WhenToHire";

const WEEKS_PER_MONTH = 4.33;

type BusinessOverviewKpis = {
  kpis: {
    mrrCents: number;
    activeCustomers: number;
    avgProfitMarginPct: number;
  };
};

type ProfitabilitySummaryEntry = {
  monthlyRevenueCents: number;
};

type OverheadData = {
  totalMonthlyOverheadCents: number;
  items?: Array<{ type: "fixed" | "variable"; monthlyCostCents: number }>;
};

type PricingConfigData = {
  pricingRules?: {
    basePrices?: {
      weekly?: number;
    };
  };
};

export default function GrowthTools() {
  const { data: overviewData } = useQuery<BusinessOverviewKpis>({
    queryKey: ["/api/business-overview"],
  });

  const { data: profSummary } = useQuery<ProfitabilitySummaryEntry[]>({
    queryKey: ["/api/profitability/summary"],
  });

  const { data: overheadData } = useQuery<OverheadData>({
    queryKey: ["/api/overhead-costs"],
  });

  const { data: pricingConfig } = useQuery<PricingConfigData>({
    queryKey: ["/api/pricing-config"],
  });

  const activeClients = overviewData?.kpis.activeCustomers ?? 0;
  const netMarginPct = overviewData?.kpis.avgProfitMarginPct ?? 30;

  const avgMonthlyRevenueCents =
    profSummary && profSummary.length > 0
      ? Math.round(
          profSummary.reduce((sum, c) => sum + c.monthlyRevenueCents, 0) / profSummary.length
        )
      : undefined;

  const fixedOverheadCents =
    overheadData?.items != null
      ? overheadData.items
          .filter((i) => i.type === "fixed")
          .reduce((s, i) => s + i.monthlyCostCents, 0)
      : overheadData?.totalMonthlyOverheadCents;

  const variableMonthlyTotalCents =
    overheadData?.items != null
      ? overheadData.items
          .filter((i) => i.type === "variable")
          .reduce((s, i) => s + i.monthlyCostCents, 0)
      : 0;

  const monthlyVisits = activeClients * WEEKS_PER_MONTH;
  const variableCostPerVisitCents =
    variableMonthlyTotalCents > 0 && monthlyVisits > 0
      ? Math.round(variableMonthlyTotalCents / monthlyVisits)
      : 0;

  const weeklyBasePriceCents =
    pricingConfig?.pricingRules?.basePrices?.weekly != null
      ? Math.round(pricingConfig.pricingRules.basePrices.weekly * 100)
      : undefined;
  const hasPricingConfig = weeklyBasePriceCents != null && weeklyBasePriceCents > 0;
  const hasOverheadData = fixedOverheadCents != null && fixedOverheadCents > 0;

  return (
    <div className="p-4 md:p-6 space-y-8 overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-growth-tools-heading">
          Growth Tools
        </h1>
        <p className="text-muted-foreground">
          Forward-looking financial tools to guide your pricing, staffing, and acquisition
          decisions.
        </p>
      </div>

      {/* Growth Scorecard */}
      <section>
        <h2 className="text-base font-semibold mb-3">Growth Scorecard</h2>
        <GrowthScorecard
          avgMonthlyRevenueCents={avgMonthlyRevenueCents}
          netMarginPct={netMarginPct}
          weeklyBasePriceCents={weeklyBasePriceCents}
          fixedOverheadCents={fixedOverheadCents}
          variableCostPerVisitCents={variableCostPerVisitCents}
          activeClients={activeClients}
          hasPricingConfig={hasPricingConfig}
          hasOverheadData={hasOverheadData}
        />
      </section>

      {/* When to Hire Calculator */}
      <section id="hire">
        <h2 className="text-base font-semibold mb-3">When to Hire</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Calculate the customer count at which hiring your first technician makes financial sense,
          and see how your income changes across scenarios.
        </p>
        <WhenToHire
          weeklyBasePriceCents={weeklyBasePriceCents}
          fixedOverheadCents={fixedOverheadCents}
          variableCostPerVisitCents={variableCostPerVisitCents}
          activeClients={activeClients}
        />
      </section>
    </div>
  );
}
