
export const BILLING_CADENCE_LABELS: Record<string, string> = {
  per_visit: "Per Visit",
  weekly: "Weekly",
  monthly: "Monthly",
  manual: "Manual",
};

export const BILLING_TRIGGER_LABELS: Record<string, string> = {
  after_job: "After Job / Per Visit",
  end_of_week: "End of Week",
  end_of_month: "End of Month",
  manual: "Manual Only",
};

export const PAYMENT_BEHAVIOR_LABELS: Record<string, string> = {
  autopay_immediate: "Autopay Immediately",
  autopay_scheduled: "Autopay on Billing Date",
  send_invoice: "Generate & Send Invoice",
  review_only: "Generate for Review Only",
};

export type BillingOrigin = "system" | "service" | "override";

interface BillingRuleInheritanceProps {
  label: string;
  value: string | null | undefined;
  labels: Record<string, string>;
  origin: BillingOrigin;
  sourceName?: string;
  muted?: boolean;
}

const ORIGIN_LABELS: Record<BillingOrigin, string> = {
  system: "System Default",
  service: "Service Rule",
  override: "Customer Override",
};

const ORIGIN_COLORS: Record<BillingOrigin, string> = {
  system: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  service: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
  override: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
};

export function BillingRuleInheritance({ label, value, labels, origin, sourceName, muted }: BillingRuleInheritanceProps) {
  const displayValue = value ? (labels[value] || value) : "—";
  const originLabel = origin === "service" && sourceName
    ? `${ORIGIN_LABELS[origin]}: ${sourceName}`
    : ORIGIN_LABELS[origin];
  return (
    <div className={`flex items-center justify-between gap-2 ${muted ? "opacity-60" : ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium">{displayValue}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ORIGIN_COLORS[origin]}`}>
          {originLabel}
        </span>
      </div>
    </div>
  );
}

export function resolveBillingField(
  _field: "cadence" | "trigger" | "payment",
  contactOverride: string | null | undefined,
  serviceRule: string | null | undefined,
  systemDefault: string,
): { value: string; origin: BillingOrigin } {
  if (contactOverride) return { value: contactOverride, origin: "override" };
  if (serviceRule) return { value: serviceRule, origin: "service" };
  return { value: systemDefault, origin: "system" };
}
