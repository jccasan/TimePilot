import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";
import type { CrmDeal, CrmPipelineStage } from "@shared/crm-schema";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export default function CrmPipeline() {
  const { toast } = useToast();

  const { data: stages = [] } = useQuery<CrmPipelineStage[]>({
    queryKey: ["/api/crm/pipeline-stages"],
    queryFn: async () => {
      const res = await fetch("/api/crm/pipeline-stages", { credentials: "include" });
      return res.json();
    },
  });

  const { data: result } = useQuery<PaginatedResult<CrmDeal>>({
    queryKey: ["/api/crm/deals", "pipeline"],
    queryFn: async () => {
      const res = await fetch("/api/crm/deals?limit=200", { credentials: "include" });
      return res.json();
    },
  });
  const deals = result?.data ?? [];

  const updateMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/deals/${id}`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
    onError: () => toast({ title: "Error updating deal", variant: "destructive" }),
  });

  const dealsByStage = stages.reduce<Record<string, CrmDeal[]>>((acc, s) => {
    acc[s.slug] = deals.filter((d) => d.stage === s.slug);
    return acc;
  }, {});

  const stageValue = (slug: string) =>
    (dealsByStage[slug] ?? []).reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-pipeline-title">
            Deal Pipeline
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Kanban view of all open deals by stage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crm/pipeline-stages">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              title="Stage Settings"
              data-testid="button-crm-pipeline-settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/crm/deals">
            <Button variant="outline" size="sm" data-testid="button-crm-deals-list">
              List View
            </Button>
          </Link>
        </div>
      </div>

      {stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading pipeline stages...</p>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {stages.map((stage) => {
              const stageDeal = dealsByStage[stage.slug] ?? [];
              const val = stageValue(stage.slug);
              return (
                <div
                  key={stage.id}
                  className="w-64 rounded-lg border border-border/50 bg-muted/30 flex flex-col"
                  style={{ borderTop: `3px solid ${stage.color}` }}
                  data-testid={`column-crm-${stage.slug}`}
                >
                  <div className="p-3 border-b border-border/30">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{stage.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {stageDeal.length}
                      </Badge>
                    </div>
                    {val > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ${(val / 100).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex-1 p-2 space-y-2 min-h-[120px]">
                    {stageDeal.map((deal) => (
                      <div
                        key={deal.id}
                        className="bg-background rounded border border-border/50 p-3 shadow-sm"
                        data-testid={`card-crm-deal-${deal.id}`}
                      >
                        <Link
                          href={`/crm/deals/${deal.id}`}
                          className="font-medium text-sm hover:text-primary line-clamp-2"
                          data-testid={`link-crm-pipeline-deal-${deal.id}`}
                        >
                          {deal.title}
                        </Link>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-muted-foreground">
                            ${((deal.value || 0) / 100).toLocaleString()}
                          </span>
                          <Select
                            value={deal.stage}
                            onValueChange={(s) => updateMutation.mutate({ id: deal.id, stage: s })}
                          >
                            <SelectTrigger
                              className="h-6 text-xs w-auto border-0 p-1 gap-1"
                              data-testid={`select-crm-deal-stage-${deal.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {stages.map((s) => (
                                <SelectItem key={s.slug} value={s.slug}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {deal.probability !== null &&
                          deal.probability !== undefined &&
                          deal.probability > 0 && (
                            <div className="mt-1.5">
                              <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${deal.probability}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {deal.probability}% probability
                              </span>
                            </div>
                          )}
                      </div>
                    ))}
                    {stageDeal.length === 0 && (
                      <div className="flex items-center justify-center h-16 text-xs text-muted-foreground/50">
                        No deals
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
