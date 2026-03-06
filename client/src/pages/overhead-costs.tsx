import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  TrendingUp,
  Calculator,
  Lock,
} from "lucide-react";

type OverheadCostItem = {
  id: string;
  companyId: string;
  category: string;
  name: string;
  monthlyCostCents: number;
  type: "fixed" | "variable";
  isDefault: boolean;
  sortOrder: number;
};

type OverheadData = {
  items: OverheadCostItem[];
  totalMonthlyOverheadCents: number;
};

const CATEGORY_ORDER = [
  "Office + Admin",
  "Marketing",
  "Vehicles + Transportation",
  "Tools + Field Supplies",
  "Labor",
  "Operations",
  "Financial Overhead",
];

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function CategorySection({
  category,
  items,
  onUpdateCost,
  onDelete,
  onAdd,
  isPending,
}: {
  category: string;
  items: OverheadCostItem[];
  onUpdateCost: (id: string, cents: number) => void;
  onDelete: (id: string) => void;
  onAdd: (category: string) => void;
  isPending: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const categoryTotal = items.reduce((s, i) => s + i.monthlyCostCents, 0);
  const fixedCount = items.filter((i) => i.type === "fixed").length;
  const variableCount = items.filter((i) => i.type === "variable").length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg overflow-hidden" data-testid={`category-section-${category}`}>
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
            data-testid={`button-toggle-category-${category}`}
          >
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{category}</span>
              <span className="text-xs text-muted-foreground">
                ({items.length} items)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {fixedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {fixedCount} fixed
                  </Badge>
                )}
                {variableCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {variableCount} variable
                  </Badge>
                )}
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${categoryTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}
                data-testid={`text-category-total-${category}`}
              >
                {formatDollars(categoryTotal)}/mo
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y">
            {items.map((item) => (
              <CostItemRow
                key={item.id}
                item={item}
                onUpdateCost={onUpdateCost}
                onDelete={onDelete}
                isPending={isPending}
              />
            ))}
          </div>
          <div className="p-2 border-t bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 w-full"
              onClick={() => onAdd(category)}
              data-testid={`button-add-item-${category}`}
            >
              <Plus className="h-3 w-3" />
              Add item
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function CostItemRow({
  item,
  onUpdateCost,
  onDelete,
  isPending,
}: {
  item: OverheadCostItem;
  onUpdateCost: (id: string, cents: number) => void;
  onDelete: (id: string) => void;
  isPending: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSavedCents = useRef(item.monthlyCostCents);

  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = (item.monthlyCostCents / 100).toFixed(2);
      lastSavedCents.current = item.monthlyCostCents;
    }
  }, [item.monthlyCostCents]);

  const handleBlur = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const parsed = parseFloat(el.value);
    if (!isNaN(parsed) && parsed >= 0) {
      const cents = Math.round(parsed * 100);
      if (cents !== lastSavedCents.current) {
        lastSavedCents.current = cents;
        onUpdateCost(item.id, cents);
      }
    } else {
      el.value = (lastSavedCents.current / 100).toFixed(2);
    }
  }, [item.id, onUpdateCost]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      const el = inputRef.current;
      if (el) el.value = (lastSavedCents.current / 100).toFixed(2);
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const isScoopilotSub = item.name === "ScooPilot subscription" && item.isDefault;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors group"
      data-testid={`cost-item-${item.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm truncate" data-testid={`text-item-name-${item.id}`}>
            {item.name}
          </span>
          {isScoopilotSub && (
            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <Badge
            variant="outline"
            className={`text-[10px] px-1 py-0 shrink-0 ${
              item.type === "fixed"
                ? "border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400"
                : "border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400"
            }`}
          >
            {item.type}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted-foreground">$</span>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          defaultValue={(item.monthlyCostCents / 100).toFixed(2)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          className="w-24 h-7 text-sm text-right tabular-nums rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`input-cost-${item.id}`}
        />
        <span className="text-xs text-muted-foreground">/mo</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.id)}
          disabled={isPending}
          data-testid={`button-delete-${item.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function OverheadCosts() {
  const { toast } = useToast();
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"fixed" | "variable">("fixed");

  const { data, isLoading } = useQuery<OverheadData>({
    queryKey: ["/api/overhead-costs"],
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/overhead-costs/seed-defaults"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
    },
  });

  useEffect(() => {
    if (data && data.items.length === 0 && !seedMutation.isPending) {
      seedMutation.mutate();
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: ({ id, monthlyCostCents }: { id: string; monthlyCostCents: number }) =>
      apiRequest("PATCH", `/api/overhead-costs/${id}`, { monthlyCostCents }),
    onMutate: async ({ id, monthlyCostCents }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/overhead-costs"] });
      const previous = queryClient.getQueryData<OverheadData>(["/api/overhead-costs"]);
      if (previous) {
        const updatedItems = previous.items.map((i) =>
          i.id === id ? { ...i, monthlyCostCents } : i
        );
        queryClient.setQueryData<OverheadData>(["/api/overhead-costs"], {
          items: updatedItems,
          totalMonthlyOverheadCents: updatedItems.reduce((s, i) => s + i.monthlyCostCents, 0),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/overhead-costs"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/overhead-costs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      toast({ title: "Item removed" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { category: string; name: string; type: "fixed" | "variable" }) =>
      apiRequest("POST", "/api/overhead-costs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      setAddingCategory(null);
      setNewItemName("");
      setNewItemType("fixed");
      toast({ title: "Item added" });
    },
  });

  const items = data?.items ?? [];

  const categorizedItems = useMemo(() => {
    const map = new Map<string, OverheadCostItem[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const item of items) {
      const existing = map.get(item.category);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.category, [item]);
      }
    }
    return map;
  }, [items]);

  const totalMonthly = items.reduce((s, i) => s + i.monthlyCostCents, 0);
  const fixedTotal = items
    .filter((i) => i.type === "fixed")
    .reduce((s, i) => s + i.monthlyCostCents, 0);
  const variableTotal = items
    .filter((i) => i.type === "variable")
    .reduce((s, i) => s + i.monthlyCostCents, 0);

  const { data: statsData } = useQuery<{ mrr: number; todaysVisits: number }>({
    queryKey: ["/api/company/stats"],
  });

  const { data: companyData } = useQuery<any>({
    queryKey: ["/api/company"],
  });

  const estimatedMonthlyStops = companyData?.pricingConfig?.estimatedMonthlyStops ?? 100;
  const overheadPerVisit = estimatedMonthlyStops > 0 ? totalMonthly / estimatedMonthlyStops : 0;

  const handleUpdateCost = (id: string, cents: number) => {
    updateMutation.mutate({ id, monthlyCostCents: cents });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleAdd = (category: string) => {
    setAddingCategory(category);
    setNewItemName("");
    setNewItemType("fixed");
  };

  const handleSubmitNewItem = () => {
    if (!addingCategory || !newItemName.trim()) return;
    createMutation.mutate({
      category: addingCategory,
      name: newItemName.trim(),
      type: newItemType,
    });
  };

  if (isLoading || seedMutation.isPending) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-overhead-costs">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto" data-testid="page-overhead-costs">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold" data-testid="text-page-title">
          Overhead Costs
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Monthly</span>
            </div>
            <p className="text-xl font-bold tabular-nums" data-testid="text-total-monthly">
              {formatDollars(totalMonthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Per Visit</span>
            </div>
            <p className="text-xl font-bold tabular-nums" data-testid="text-per-visit">
              {formatDollars(Math.round(overheadPerVisit))}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Based on {estimatedMonthlyStops} visits/mo
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs text-muted-foreground">Fixed</span>
            </div>
            <p className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400" data-testid="text-fixed-total">
              {formatDollars(fixedTotal)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">Variable</span>
            </div>
            <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400" data-testid="text-variable-total">
              {formatDollars(variableTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {Array.from(categorizedItems.entries()).map(([category, catItems]) => {
          if (catItems.length === 0 && !CATEGORY_ORDER.includes(category)) return null;
          return (
            <CategorySection
              key={category}
              category={category}
              items={catItems}
              onUpdateCost={handleUpdateCost}
              onDelete={handleDelete}
              onAdd={handleAdd}
              isPending={updateMutation.isPending || deleteMutation.isPending}
            />
          );
        })}
      </div>

      {addingCategory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="modal-add-item">
          <Card className="w-full max-w-sm mx-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Add item to {addingCategory}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Item name"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitNewItem();
                  if (e.key === "Escape") setAddingCategory(null);
                }}
                data-testid="input-new-item-name"
              />
              <Select
                value={newItemType}
                onValueChange={(v) => setNewItemType(v as "fixed" | "variable")}
              >
                <SelectTrigger className="h-9" data-testid="select-new-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed cost</SelectItem>
                  <SelectItem value="variable">Variable cost</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingCategory(null)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmitNewItem}
                  disabled={!newItemName.trim() || createMutation.isPending}
                  data-testid="button-confirm-add"
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
