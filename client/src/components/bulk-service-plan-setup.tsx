import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MapIcon,
  CalendarIcon,
  DollarSign,
  Route,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 25;

interface UnscheduledContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  serviceFrequency: string | null;
  serviceDay: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  propertyId: string | null;
  hasProperty: boolean;
  hasAddress: boolean;
  hasFrequency: boolean;
  issues: string[];
}

interface BulkResult {
  created: number;
  failures: { contactId: string; reason: string }[];
  visitsCreated: number;
  stopsAssigned: number;
  routesCreated: number;
  routeSummary: { day: string; routeName: string; stopsPlaced: number }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importRunId?: string;
  preselectedContactIds?: string[];
  title?: string;
}

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  onetime: "One-time",
};

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function BulkServicePlanSetup({
  open,
  onOpenChange,
  importRunId,
  preselectedContactIds,
  title,
}: Props) {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [defaultPrice, setDefaultPrice] = useState("29.99");
  const [autoAssign, setAutoAssign] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BulkResult | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [page, setPage] = useState(0);

  const queryKey = importRunId
    ? [`/api/contacts/unscheduled?importRunId=${importRunId}`]
    : ["/api/contacts/unscheduled"];

  const { data: unscheduled = [], isLoading } = useQuery<UnscheduledContact[]>({
    queryKey,
    enabled: open,
  });

  const eligibleContacts = unscheduled.filter((c) => {
    if (preselectedContactIds && preselectedContactIds.length > 0) {
      return preselectedContactIds.includes(c.id);
    }
    return true;
  });

  useEffect(() => {
    if (open && !initialized && eligibleContacts.length > 0) {
      setSelectedIds(
        new Set(
          eligibleContacts
            .filter((c) => c.hasProperty && c.hasAddress && c.hasFrequency)
            .map((c) => c.id)
        )
      );
      setInitialized(true);
    }
  }, [open, initialized, eligibleContacts]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const eligible = eligibleContacts.filter(
      (c) => c.hasProperty && c.hasAddress && c.hasFrequency
    );
    if (selectedIds.size === eligible.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligible.map((c) => c.id)));
    }
  };

  const handleDefaultPriceChange = (val: string) => {
    setDefaultPrice(val);
  };

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const items = eligibleContacts
        .filter((c) => selectedIds.has(c.id))
        .filter((c) => c.hasProperty && c.propertyId && c.hasFrequency)
        .map((c) => ({
          contactId: c.id,
          propertyId: c.propertyId!,
          frequency: c.serviceFrequency!,
          dayOfWeek: c.serviceDay || null,
          startDate,
          pricePerVisit: customPrices[c.id] || defaultPrice,
        }));

      if (items.length === 0) throw new Error("No valid contacts selected");

      const res = await apiRequest("POST", "/api/service-plans/bulk", { items, autoAssign });
      return res.json() as Promise<BulkResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Service plans created",
        description: `${data.created} service plan${data.created !== 1 ? "s" : ""} created for ${data.visitsCreated} visits.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setResult(null);
    setInitialized(false);
    setSelectedIds(new Set());
    setCustomPrices({});
    setPage(0);
    onOpenChange(false);
  };

  const totalPages = Math.ceil(eligibleContacts.length / PAGE_SIZE);
  const pagedContacts = eligibleContacts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const selectedAndEligible = eligibleContacts.filter(
    (c) => selectedIds.has(c.id) && c.hasProperty && c.propertyId && c.hasFrequency
  );

  const eligibleCount = eligibleContacts.filter(
    (c) => c.hasProperty && c.hasAddress && c.hasFrequency
  ).length;
  const invalidCount = eligibleContacts.filter(
    (c) => !c.hasProperty || !c.hasAddress || !c.hasFrequency
  ).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-bulk-service-plan"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-bulk-setup-title">
            {title || "Bulk Create Service Plans"}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4" data-testid="bulk-result-section">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Done!</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    <strong>{result.created}</strong> service plan{result.created !== 1 ? "s" : ""}{" "}
                    created
                  </p>
                  <p>
                    <strong>{result.visitsCreated}</strong> visits scheduled for the next 6 months
                  </p>
                  {result.stopsAssigned > 0 && (
                    <p>
                      <strong>{result.stopsAssigned}</strong> stop
                      {result.stopsAssigned !== 1 ? "s" : ""} placed on routes (
                      {result.routesCreated} new route{result.routesCreated !== 1 ? "s" : ""}{" "}
                      created)
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>

            {result.routeSummary.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Route Assignments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {result.routeSummary.map((r) => (
                      <div
                        key={r.day}
                        className="flex items-center justify-between text-sm py-1 border-b last:border-0"
                        data-testid={`route-summary-${r.day}`}
                      >
                        <div className="flex items-center gap-2">
                          <Route className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{r.routeName}</span>
                          <span className="text-muted-foreground capitalize">({r.day})</span>
                        </div>
                        <Badge variant="secondary">
                          {r.stopsPlaced} stop{r.stopsPlaced !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {result.failures.length > 0 && (
              <Alert variant="destructive" data-testid="alert-bulk-failures">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{result.failures.length} contacts could not be set up</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 mt-2 space-y-1 text-sm">
                    {result.failures.slice(0, 10).map((f, i) => (
                      <li key={i}>{f.reason}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Button onClick={handleClose} data-testid="button-close-bulk-result">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {isLoading ? (
              <div
                className="flex items-center justify-center py-12 gap-2"
                data-testid="loading-unscheduled"
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading contacts...</span>
              </div>
            ) : eligibleContacts.length === 0 ? (
              <Alert data-testid="alert-no-unscheduled">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>All set!</AlertTitle>
                <AlertDescription>
                  All contacts already have service plans, or no contacts match the criteria.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {invalidCount > 0 && (
                  <Alert data-testid="alert-invalid-contacts">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      {invalidCount} contact{invalidCount !== 1 ? "s" : ""} cannot be set up
                      automatically
                    </AlertTitle>
                    <AlertDescription>
                      These contacts are missing an address or service frequency. Fix them
                      individually to include them.
                    </AlertDescription>
                  </Alert>
                )}

                <Card data-testid="card-defaults-bar">
                  <CardContent className="pt-4">
                    <div className="flex flex-wrap gap-4 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor="input-start-date">
                          <CalendarIcon className="h-3 w-3 inline mr-1" />
                          Start Date
                        </Label>
                        <Input
                          id="input-start-date"
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-40"
                          data-testid="input-start-date"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor="input-default-price">
                          <DollarSign className="h-3 w-3 inline mr-1" />
                          Default Price / Visit
                        </Label>
                        <Input
                          id="input-default-price"
                          type="number"
                          step="0.01"
                          min="0"
                          value={defaultPrice}
                          onChange={(e) => handleDefaultPriceChange(e.target.value)}
                          className="w-32"
                          data-testid="input-default-price"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="checkbox-auto-assign"
                          checked={autoAssign}
                          onCheckedChange={(v) => setAutoAssign(!!v)}
                          data-testid="checkbox-auto-assign"
                        />
                        <Label htmlFor="checkbox-auto-assign" className="text-sm cursor-pointer">
                          <MapIcon className="h-3 w-3 inline mr-1" />
                          Auto-assign to routes by day
                        </Label>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="rounded-md border overflow-hidden">
                  <Table data-testid="table-unscheduled-contacts">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedIds.size === eligibleCount && eligibleCount > 0}
                            onCheckedChange={toggleAll}
                            data-testid="checkbox-select-all-unscheduled"
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Day</TableHead>
                        <TableHead>Price / Visit</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedContacts.map((contact) => {
                        const canSelect =
                          contact.hasProperty && contact.hasAddress && contact.hasFrequency;
                        return (
                          <TableRow
                            key={contact.id}
                            data-testid={`row-unscheduled-${contact.id}`}
                            className={!canSelect ? "opacity-60" : ""}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(contact.id)}
                                onCheckedChange={() => canSelect && toggleSelect(contact.id)}
                                disabled={!canSelect}
                                data-testid={`checkbox-unscheduled-${contact.id}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {contact.firstName} {contact.lastName}
                              {contact.email && (
                                <p className="text-xs text-muted-foreground">{contact.email}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {contact.streetAddress ? (
                                <span>
                                  {contact.streetAddress}
                                  {contact.city ? `, ${contact.city}` : ""}
                                </span>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  No address
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {contact.serviceFrequency ? (
                                FREQUENCY_LABELS[contact.serviceFrequency] ||
                                contact.serviceFrequency
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Missing
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm capitalize">
                              {contact.serviceDay ? (
                                DAY_LABELS[contact.serviceDay] || contact.serviceDay
                              ) : (
                                <span className="text-muted-foreground text-xs">TBD</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={customPrices[contact.id] ?? defaultPrice}
                                onChange={(e) =>
                                  setCustomPrices((prev) => ({
                                    ...prev,
                                    [contact.id]: e.target.value,
                                  }))
                                }
                                className="w-24 h-7 text-sm"
                                disabled={!canSelect}
                                data-testid={`input-price-${contact.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              {contact.issues.length > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                                  data-testid={`badge-issues-${contact.id}`}
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {contact.issues[0]}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-green-300 text-green-700 dark:border-green-600 dark:text-green-400"
                                  data-testid={`badge-ready-${contact.id}`}
                                >
                                  Ready
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div
                    className="flex items-center justify-between gap-2"
                    data-testid="pagination-bulk"
                  >
                    <span className="text-xs text-muted-foreground">
                      Page {page + 1} of {totalPages} ({eligibleContacts.length} total)
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        data-testid="button-bulk-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        data-testid="button-bulk-next-page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground" data-testid="text-selection-summary">
                    {selectedAndEligible.length} of {eligibleCount} eligible contact
                    {eligibleCount !== 1 ? "s" : ""} selected
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleClose}
                      data-testid="button-cancel-bulk"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => bulkMutation.mutate()}
                      disabled={bulkMutation.isPending || selectedAndEligible.length === 0}
                      data-testid="button-generate-service-plans"
                    >
                      {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Generate{" "}
                      {selectedAndEligible.length > 0 ? `${selectedAndEligible.length} ` : ""}
                      Service Plan{selectedAndEligible.length !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
