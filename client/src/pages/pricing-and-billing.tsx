import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Pricing from "@/pages/pricing";
import { MyPricingTab, CostModelSections } from "@/pages/unified-pricing-engine";
import { BillingDefaultsSection, StripeConnectSection } from "@/pages/settings";
import { FrequencyTogglesCard } from "@/components/pricing-billing/frequency-toggles-card";
import { TierNamesCard } from "@/components/pricing-billing/tier-names-card";
import { ChargeTimingCard } from "@/components/pricing-billing/charge-timing-card";
import type { Company, PricingConfig, ServicePackage, ServicePricingItem } from "@shared/schema";

const SECTIONS = [
  { id: "packages", label: "What you sell" },
  { id: "pricing", label: "What you charge" },
  { id: "cost-model", label: "Cost model" },
  { id: "billing", label: "Billing" },
] as const;

const CHARGE_TIMING_LABELS: Record<string, string> = {
  beginning_of_month: "beginning of month",
  day_before: "day before service",
  weekly_batch: "weekly batch",
};

const COST_MODEL_OPEN_KEY = "pab-cost-model-open";

export default function PricingAndBilling() {
  const [active, setActive] = useState<string>("packages");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // ── Data for the status bar (reuses the same endpoints the sections load) ────
  const { data: packages } = useQuery<ServicePackage[]>({ queryKey: ["/api/packages"] });
  const { data: pricingItems } = useQuery<ServicePricingItem[]>({ queryKey: ["/api/pricing"] });
  const { data: pricingConfig } = useQuery<PricingConfig>({ queryKey: ["/api/pricing-config"] });
  const { data: company } = useQuery<Company>({ queryKey: ["/api/company"] });

  const packageCount = packages?.length ?? 0;
  const pricingConfigured =
    (pricingItems?.some((p) => p.category === "recurring_service" && p.isActive) ?? false) ||
    !!pricingConfig?.pricingRules;
  const chargeTiming = company?.chargeTiming || "beginning_of_month";
  const chargeTimingLabel = CHARGE_TIMING_LABELS[chargeTiming] || chargeTiming;

  // ── Cost model collapse: collapsed by default on a fresh account, but
  // remembers the operator's choice once they expand it. ───────────────────────
  const [costModelOpen, setCostModelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COST_MODEL_OPEN_KEY) === "1";
  });
  const toggleCostModel = () => {
    setCostModelOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COST_MODEL_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // ── Active-pill tracking via IntersectionObserver ────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      // Bias the trigger line below the sticky nav so the pill flips as a
      // section's heading reaches the top of the content area.
      { rootMargin: "-96px 0px -55% 0px", threshold: [0, 0.1, 0.5] }
    );
    SECTIONS.forEach((s) => {
      const el = sectionRefs.current[s.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  // On load, honor a #section anchor (e.g. from a redirect like
  // /pricing-settings#cost-model). Runs once after refs are attached.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && SECTIONS.some((s) => s.id === hash)) {
      const t = setTimeout(() => {
        sectionRefs.current[hash]?.scrollIntoView({ behavior: "auto", block: "start" });
        setActive(hash);
      }, 50);
      return () => clearTimeout(t);
    }
  }, []);

  const registerSection = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {/* Heading */}
        <div className="mb-3">
          <h1 className="text-2xl font-bold" data-testid="text-pricing-billing-heading">
            Pricing and billing
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything about what you sell, what you charge, your cost model, and how customers are
            billed — in one place.
          </p>
        </div>

        {/* Setup status bar */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-4"
          data-testid="status-bar-pricing-billing"
        >
          <button
            type="button"
            onClick={() => scrollTo("packages")}
            className="flex items-center gap-1.5 hover:underline"
            data-testid="status-packages"
          >
            {packageCount > 0 ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            <span>Packages: {packageCount} defined</span>
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => scrollTo("pricing")}
            className="flex items-center gap-1.5 hover:underline"
            data-testid="status-pricing"
          >
            {pricingConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            <span>Pricing: {pricingConfigured ? "configured" : "not configured"}</span>
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => scrollTo("billing")}
            className="flex items-center gap-1.5 hover:underline"
            data-testid="status-billing"
          >
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>Billing: {chargeTimingLabel}</span>
          </button>
        </div>

        {/* Sticky section navigator */}
        <nav
          className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur border-b mb-6"
          data-testid="nav-pricing-billing-sections"
        >
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                  active === s.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
                data-testid={`pill-${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Section 1 — What you sell */}
        <section
          id="packages"
          ref={registerSection("packages")}
          className="scroll-mt-24 space-y-4 mb-12"
        >
          <h2 className="text-xl font-semibold">What you sell</h2>
          <FrequencyTogglesCard />
          <TierNamesCard />
          <Pricing embedded />
        </section>

        {/* Section 2 — What you charge */}
        <section
          id="pricing"
          ref={registerSection("pricing")}
          className="scroll-mt-24 space-y-4 mb-12"
        >
          <h2 className="text-xl font-semibold">What you charge</h2>
          <MyPricingTab />
        </section>

        {/* Section 3 — Cost model (advanced, collapsible) */}
        <section
          id="cost-model"
          ref={registerSection("cost-model")}
          className="scroll-mt-24 space-y-4 mb-12"
        >
          <div className="rounded-lg border bg-muted/40 p-4">
            <button
              type="button"
              onClick={toggleCostModel}
              className="flex w-full items-center justify-between gap-2 text-left"
              data-testid="toggle-cost-model"
              aria-expanded={costModelOpen}
            >
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  {costModelOpen ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                  Cost model
                </h2>
                <p className="text-xs text-muted-foreground mt-1 ml-7">
                  Advanced configuration — affects profitability analysis and price suggestions.
                </p>
              </div>
            </button>
            {costModelOpen && (
              <div className="mt-4">
                <CostModelSections />
              </div>
            )}
          </div>
        </section>

        {/* Section 4 — Billing */}
        <section
          id="billing"
          ref={registerSection("billing")}
          className="scroll-mt-24 space-y-4 mb-12"
        >
          <h2 className="text-xl font-semibold">Billing</h2>
          <ChargeTimingCard />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Default billing trigger &amp; invoice numbering</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Company-wide defaults for when invoices are generated, default payment behavior, and
                invoice number format. Individual customers can override the billing trigger on their
                record.
              </p>
            </CardHeader>
            <CardContent>
              <BillingDefaultsSection
                company={company as Parameters<typeof BillingDefaultsSection>[0]["company"]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Payments &amp; Stripe</CardTitle>
            </CardHeader>
            <CardContent>
              <StripeConnectSection />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
