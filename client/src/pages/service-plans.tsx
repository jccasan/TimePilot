import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ClipboardList,
  ExternalLink,
  CheckSquare,
  XSquare,
  DollarSign,
  Calendar,
  MapPin,
} from "lucide-react";
import type { ServicePlan, Route } from "@shared/schema";

type EnrichedPlan = ServicePlan & {
  addOns?: { id: string; servicePricingId: string; name: string; price: string }[];
  contactName: string;
  propertyAddress: string;
  routeName: string | null;
};

type SortField = "contactName" | "propertyAddress" | "frequency" | "dayOfWeek" | "pricePerVisit" | "routeName" | "isActive" | "jobType";
type SortDir = "asc" | "desc";

const DAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  onetime: "One-time",
};

export default function ServicePlans() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterFrequency, setFilterFrequency] = useState("all");
  const [filterDay, setFilterDay] = useState("all");
  const [filterRoute, setFilterRoute] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriceMin, setFilterPriceMin] = useState("");
  const [filterPriceMax, setFilterPriceMax] = useState("");
  const [sortField, setSortField] = useState<SortField>("contactName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<"price" | "day" | "status" | "route" | null>(null);
  const [priceMode, setPriceMode] = useState<"flat" | "percentage">("flat");
  const [priceAmount, setPriceAmount] = useState("");
  const [bulkDay, setBulkDay] = useState("monday");
  const [bulkStatus, setBulkStatus] = useState("true");
  const [bulkRouteId, setBulkRouteId] = useState("");

  const { data: plans, isLoading } = useQuery<EnrichedPlan[]>({
    queryKey: ["/api/service-plans"],
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const routeMap = useMemo(() => {
    if (!routes) return new Map<string, string>();
    return new Map(routes.map(r => [r.id, r.name]));
  }, [routes]);

  const bulkMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; updates: any }) => {
      const res = await apiRequest("PATCH", "/api/service-plans/bulk", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Bulk Update Complete", description: `${data.updated} service plan(s) updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      setSelectedIds(new Set());
      setBulkDialogOpen(false);
      setBulkAction(null);
    },
    onError: (err: Error) => {
      toast({ title: "Bulk Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!plans) return [];
    let result = [...plans];

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.contactName.toLowerCase().includes(s) ||
          p.propertyAddress.toLowerCase().includes(s) ||
          (p.serviceName || "").toLowerCase().includes(s)
      );
    }

    if (filterFrequency !== "all") result = result.filter((p) => p.frequency === filterFrequency);
    if (filterDay !== "all") result = result.filter((p) => p.dayOfWeek === filterDay);
    if (filterRoute !== "all") {
      if (filterRoute === "unassigned") {
        result = result.filter((p) => !p.routeId);
      } else {
        result = result.filter((p) => p.routeId === filterRoute);
      }
    }
    if (filterStatus !== "all") {
      if (filterStatus === "active") result = result.filter((p) => p.isActive);
      else if (filterStatus === "paused") result = result.filter((p) => !p.isActive);
    }
    if (filterPriceMin) {
      const min = parseFloat(filterPriceMin);
      if (!isNaN(min)) result = result.filter((p) => parseFloat(p.pricePerVisit) >= min);
    }
    if (filterPriceMax) {
      const max = parseFloat(filterPriceMax);
      if (!isNaN(max)) result = result.filter((p) => parseFloat(p.pricePerVisit) <= max);
    }

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "contactName": aVal = a.contactName; bVal = b.contactName; break;
        case "propertyAddress": aVal = a.propertyAddress; bVal = b.propertyAddress; break;
        case "frequency": aVal = a.frequency; bVal = b.frequency; break;
        case "dayOfWeek": aVal = a.dayOfWeek || ""; bVal = b.dayOfWeek || ""; break;
        case "pricePerVisit": aVal = parseFloat(a.pricePerVisit); bVal = parseFloat(b.pricePerVisit); break;
        case "routeName": aVal = a.routeName || ""; bVal = b.routeName || ""; break;
        case "isActive": aVal = a.isActive ? 1 : 0; bVal = b.isActive ? 1 : 0; break;
        case "jobType": aVal = a.jobType || ""; bVal = b.jobType || ""; break;
        default: aVal = ""; bVal = "";
      }
      if (typeof aVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      return sortDir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });

    return result;
  }, [plans, search, filterFrequency, filterDay, filterRoute, filterStatus, filterPriceMin, filterPriceMax, sortField, sortDir]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`button-sort-${field}`}
      >
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function openBulkDialog(action: "price" | "day" | "status" | "route") {
    setBulkAction(action);
    setPriceMode("flat");
    setPriceAmount("");
    setBulkDay("monday");
    setBulkStatus("true");
    setBulkRouteId("");
    setBulkDialogOpen(true);
  }

  function handleBulkSubmit() {
    const ids = Array.from(selectedIds);
    let updates: any = {};

    switch (bulkAction) {
      case "price":
        if (!priceAmount || isNaN(parseFloat(priceAmount))) {
          toast({ title: "Invalid Amount", description: "Enter a valid number.", variant: "destructive" });
          return;
        }
        updates = { priceAdjustment: { type: priceMode, amount: parseFloat(priceAmount) } };
        break;
      case "day":
        updates = { dayOfWeek: bulkDay };
        break;
      case "status":
        updates = { isActive: bulkStatus === "true" };
        break;
      case "route":
        updates = { routeId: bulkRouteId === "__unassigned__" ? null : bulkRouteId };
        break;
    }

    bulkMutation.mutate({ ids, updates });
  }

  function getBulkPreviewText() {
    const count = selectedIds.size;
    switch (bulkAction) {
      case "price":
        if (!priceAmount) return `${count} plan(s) selected`;
        if (priceMode === "flat") return `Adjust price by $${priceAmount} on ${count} plan(s)`;
        return `Adjust price by ${priceAmount}% on ${count} plan(s)`;
      case "day":
        return `Change day to ${DAY_LABELS[bulkDay]} for ${count} plan(s) (routes auto-assigned)`;
      case "status":
        return `${bulkStatus === "true" ? "Activate" : "Pause"} ${count} plan(s)`;
      case "route":
        const routeName = bulkRouteId === "__unassigned__" ? "Unassigned" : (bulkRouteId ? routeMap.get(bulkRouteId) || "Unknown" : "—");
        return `Reassign ${count} plan(s) to route: ${routeName}`;
      default:
        return "";
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-service-plans">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="page-service-plans">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Service Plans</h1>
          <Badge variant="secondary" data-testid="badge-plan-count">{plans?.length || 0} total</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by client, property, or service name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={filterFrequency} onValueChange={setFilterFrequency}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-frequency">
                <SelectValue placeholder="Frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Frequencies</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="onetime">One-time</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterDay} onValueChange={setFilterDay}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-day">
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Days</SelectItem>
                {Object.entries(DAY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterRoute} onValueChange={setFilterRoute}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-route">
                <SelectValue placeholder="Route" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Routes</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {routes?.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[120px]" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="Min $"
                value={filterPriceMin}
                onChange={(e) => setFilterPriceMin(e.target.value)}
                className="w-[80px]"
                data-testid="input-filter-price-min"
              />
              <span className="text-muted-foreground text-xs">-</span>
              <Input
                type="number"
                placeholder="Max $"
                value={filterPriceMax}
                onChange={(e) => setFilterPriceMax(e.target.value)}
                className="w-[80px]"
                data-testid="input-filter-price-max"
              />
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg" data-testid="section-bulk-actions">
              <span className="text-sm font-medium" data-testid="text-selected-count">{selectedIds.size} selected</span>
              <div className="flex gap-2 ml-auto">
                <Button size="sm" variant="outline" onClick={() => openBulkDialog("price")} data-testid="button-bulk-price">
                  <DollarSign className="h-3.5 w-3.5 mr-1" /> Price
                </Button>
                <Button size="sm" variant="outline" onClick={() => openBulkDialog("day")} data-testid="button-bulk-day">
                  <Calendar className="h-3.5 w-3.5 mr-1" /> Day
                </Button>
                <Button size="sm" variant="outline" onClick={() => openBulkDialog("route")} data-testid="button-bulk-route">
                  <MapPin className="h-3.5 w-3.5 mr-1" /> Route
                </Button>
                <Button size="sm" variant="outline" onClick={() => openBulkDialog("status")} data-testid="button-bulk-status">
                  <CheckSquare className="h-3.5 w-3.5 mr-1" /> Status
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
                  <XSquare className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-service-plans">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="p-2 text-left"><SortHeader field="contactName" label="Client" /></th>
                  <th className="p-2 text-left hidden md:table-cell"><SortHeader field="propertyAddress" label="Property" /></th>
                  <th className="p-2 text-left"><SortHeader field="frequency" label="Frequency" /></th>
                  <th className="p-2 text-left hidden sm:table-cell"><SortHeader field="dayOfWeek" label="Day" /></th>
                  <th className="p-2 text-right"><SortHeader field="pricePerVisit" label="Price" /></th>
                  <th className="p-2 text-left hidden lg:table-cell"><SortHeader field="routeName" label="Route" /></th>
                  <th className="p-2 text-left"><SortHeader field="isActive" label="Status" /></th>
                  <th className="p-2 text-left hidden xl:table-cell">Add-ons</th>
                  <th className="p-2 text-left hidden xl:table-cell"><SortHeader field="jobType" label="Type" /></th>
                  <th className="p-2 text-center w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-muted-foreground" data-testid="text-empty-state">
                      No service plans found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((plan) => (
                    <tr
                      key={plan.id}
                      className={`border-b hover:bg-muted/50 transition-colors ${selectedIds.has(plan.id) ? "bg-primary/5" : ""}`}
                      data-testid={`row-plan-${plan.id}`}
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={selectedIds.has(plan.id)}
                          onCheckedChange={() => toggleSelect(plan.id)}
                          data-testid={`checkbox-plan-${plan.id}`}
                        />
                      </td>
                      <td className="p-2 font-medium" data-testid={`text-client-${plan.id}`}>{plan.contactName}</td>
                      <td className="p-2 text-muted-foreground hidden md:table-cell max-w-[200px] truncate" data-testid={`text-property-${plan.id}`}>
                        {plan.propertyAddress}
                      </td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs" data-testid={`badge-frequency-${plan.id}`}>
                          {FREQ_LABELS[plan.frequency] || plan.frequency}
                        </Badge>
                      </td>
                      <td className="p-2 hidden sm:table-cell" data-testid={`text-day-${plan.id}`}>
                        {plan.dayOfWeek ? DAY_LABELS[plan.dayOfWeek] : "—"}
                      </td>
                      <td className="p-2 text-right font-medium" data-testid={`text-price-${plan.id}`}>
                        ${parseFloat(plan.pricePerVisit).toFixed(2)}
                      </td>
                      <td className="p-2 hidden lg:table-cell" data-testid={`text-route-${plan.id}`}>
                        {plan.routeName || <span className="text-muted-foreground">Unassigned</span>}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={plan.isActive ? "default" : "secondary"}
                          className="text-xs"
                          data-testid={`badge-status-${plan.id}`}
                        >
                          {plan.isActive ? "Active" : "Paused"}
                        </Badge>
                      </td>
                      <td className="p-2 hidden xl:table-cell" data-testid={`text-addons-${plan.id}`}>
                        {plan.addOns && plan.addOns.length > 0
                          ? plan.addOns.map((a) => a.name).join(", ")
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 hidden xl:table-cell capitalize" data-testid={`text-type-${plan.id}`}>
                        {plan.jobType || "recurring"}
                      </td>
                      <td className="p-2 text-center">
                        <Link href={`/contacts/${plan.contactId}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`link-contact-${plan.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted-foreground" data-testid="text-results-count">
            Showing {filtered.length} of {plans?.length || 0} plans
          </div>
        </CardContent>
      </Card>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent data-testid="dialog-bulk-edit">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {bulkAction === "price" && "Adjust Price"}
              {bulkAction === "day" && "Change Day of Week"}
              {bulkAction === "status" && "Change Status"}
              {bulkAction === "route" && "Reassign Route"}
            </DialogTitle>
            <DialogDescription data-testid="text-dialog-description">
              This will update {selectedIds.size} selected service plan(s).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {bulkAction === "price" && (
              <>
                <div className="space-y-2">
                  <Label>Adjustment Type</Label>
                  <RadioGroup value={priceMode} onValueChange={(v) => setPriceMode(v as "flat" | "percentage")} className="flex gap-4">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="flat" id="flat" data-testid="radio-flat" />
                      <Label htmlFor="flat">Flat Amount ($)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="percentage" id="percentage" data-testid="radio-percentage" />
                      <Label htmlFor="percentage">Percentage (%)</Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="space-y-2">
                  <Label>{priceMode === "flat" ? "Amount ($)" : "Percentage (%)"}</Label>
                  <Input
                    type="number"
                    step={priceMode === "flat" ? "0.01" : "1"}
                    placeholder={priceMode === "flat" ? "e.g. 5.00 or -3.00" : "e.g. 10 or -5"}
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    data-testid="input-price-amount"
                  />
                  <p className="text-xs text-muted-foreground">
                    {priceMode === "flat" ? "Use negative values to decrease price." : "Use negative values to decrease price by percentage."}
                  </p>
                </div>
              </>
            )}

            {bulkAction === "day" && (
              <div className="space-y-2">
                <Label>New Day of Week</Label>
                <Select value={bulkDay} onValueChange={setBulkDay}>
                  <SelectTrigger data-testid="select-bulk-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DAY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Routes will be auto-assigned based on the new day.</p>
              </div>
            )}

            {bulkAction === "status" && (
              <div className="space-y-2">
                <Label>New Status</Label>
                <RadioGroup value={bulkStatus} onValueChange={setBulkStatus} className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="true" id="active" data-testid="radio-active" />
                    <Label htmlFor="active">Active</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="false" id="paused" data-testid="radio-paused" />
                    <Label htmlFor="paused">Paused</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {bulkAction === "route" && (
              <div className="space-y-2">
                <Label>Assign to Route</Label>
                <Select value={bulkRouteId} onValueChange={setBulkRouteId}>
                  <SelectTrigger data-testid="select-bulk-route">
                    <SelectValue placeholder="Select a route" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {routes?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name} ({DAY_LABELS[r.dayOfWeek] || r.dayOfWeek})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="p-3 bg-muted rounded-lg text-sm" data-testid="text-bulk-preview">
              {getBulkPreviewText()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)} data-testid="button-bulk-cancel">
              Cancel
            </Button>
            <Button onClick={handleBulkSubmit} disabled={bulkMutation.isPending || (bulkAction === "route" && !bulkRouteId)} data-testid="button-bulk-confirm">
              {bulkMutation.isPending ? "Updating..." : "Apply Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
