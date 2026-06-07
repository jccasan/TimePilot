import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CalendarClock } from "lucide-react";

/**
 * Charge timing is a billing-workflow concept, not a Stripe concept. It was
 * previously rendered inside the Stripe Connect settings card by accident of
 * implementation; this standalone component is its proper home, at the top of
 * the Billing section. Persists via PATCH /api/company.
 */
export function ChargeTimingCard() {
  const { toast } = useToast();
  const { data: company } = useQuery<{ chargeTiming?: string }>({ queryKey: ["/api/company"] });

  const mutation = useMutation({
    mutationFn: async (value: string) => {
      const res = await apiRequest("PATCH", "/api/company", { chargeTiming: value });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save setting");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Charge timing saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-charge-timing">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Charge timing
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Controls when recurring customers are billed.
        </p>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={company?.chargeTiming || "beginning_of_month"}
          onValueChange={(v) => mutation.mutate(v)}
          disabled={mutation.isPending}
          className="space-y-2"
        >
          <label
            htmlFor="ct-bom"
            className="flex items-start gap-3 rounded-lg border-2 border-primary bg-primary/5 p-3 cursor-pointer"
          >
            <RadioGroupItem
              value="beginning_of_month"
              id="ct-bom"
              className="mt-0.5"
              data-testid="radio-charge-timing-bom"
            />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Charge on the 1st for the full month ahead — prepay
                </span>
                <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                  Recommended
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                On the 1st of each month, customers are billed for the full upcoming month.
                Mid-month signups are prorated for the remaining days. Default for new accounts.
              </p>
            </div>
          </label>
          <label
            htmlFor="ct-day-before"
            className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer"
          >
            <RadioGroupItem
              value="day_before"
              id="ct-day-before"
              className="mt-0.5"
              data-testid="radio-charge-timing-day-before"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Day before service</span>
              <p className="text-xs text-muted-foreground">
                Bill each service the day before it happens.
              </p>
            </div>
          </label>
          <label
            htmlFor="ct-weekly"
            className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer"
          >
            <RadioGroupItem
              value="weekly_batch"
              id="ct-weekly"
              className="mt-0.5"
              data-testid="radio-charge-timing-weekly"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Weekly batch</span>
              <p className="text-xs text-muted-foreground">
                Bill all of a customer's services together once a week.
              </p>
            </div>
          </label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
