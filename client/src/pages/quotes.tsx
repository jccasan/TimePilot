/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import type { Quote, Contact, Property } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Send,
  Eye,
  Trash2,
  Pencil,
  ClipboardCheck,
  Search,
  DollarSign,
  Home,
  Building2,
  Loader2,
  CheckCircle2,
  Clock,
  FileText,
  X,
  Ruler,
  Download,
  ChevronDown,
} from "lucide-react";
import type { ServicePricingItem } from "@shared/schema";
import { YardMeasureTool } from "@/components/yard-measure-tool";
import { AddressAutocomplete } from "@/components/address-autocomplete";

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  accepted: { label: "Accepted", variant: "default" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "outline" },
};

const frequencyLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  onetime: "One-time",
  "1x_weekly": "Weekly",
  "2x_weekly": "2x Weekly",
  "3x_weekly": "3x Weekly",
};

interface TierPricing {
  essential: number;
  premium: number;
  deluxe: number;
  initialCleanFee: number;
  essentialFeatures: string[];
  premiumFeatures: string[];
  deluxeFeatures: string[];
  breakdown: Record<string, any>;
}

function TierPreviewCards({
  pricing,
  selectedTier,
  onSelectTier,
}: {
  pricing: TierPricing;
  selectedTier?: string;
  onSelectTier?: (tier: string) => void;
}) {
  const { formatMoney } = useCurrency();
  const tiers = [
    {
      key: "essential",
      name: "Essential",
      price: pricing.essential,
      features: pricing.essentialFeatures,
      color: "border-slate-300",
      bg: "bg-slate-50",
    },
    {
      key: "premium",
      name: "Property Care",
      price: pricing.premium,
      features: pricing.premiumFeatures,
      color: "border-green-500",
      bg: "bg-green-50",
      recommended: true,
    },
    {
      key: "deluxe",
      name: "Deluxe",
      price: pricing.deluxe,
      features: pricing.deluxeFeatures,
      color: "border-violet-500",
      bg: "bg-violet-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {tiers.map((tier) => (
        <div
          key={tier.key}
          data-testid={`tier-card-${tier.key}`}
          className={`relative border-2 rounded-lg p-4 cursor-pointer transition-all ${
            selectedTier === tier.key
              ? `${tier.color} ${tier.bg} ring-2 ring-offset-1`
              : "border-gray-200 hover:border-gray-300"
          }`}
          onClick={() => onSelectTier?.(tier.key)}
        >
          {tier.recommended && (
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
              <Badge className="bg-green-600 text-white text-[10px]">Most Popular</Badge>
            </div>
          )}
          <div className="text-center mb-3">
            <p className="text-sm font-medium text-muted-foreground">{tier.name}</p>
            <p className="text-2xl font-bold">
              {formatMoney(tier.price)}
              <span className="text-xs font-normal text-muted-foreground">/visit</span>
            </p>
          </div>
          <ul className="space-y-1">
            {(Array.isArray(tier.features) ? tier.features : []).slice(0, 4).map((f, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
            {Array.isArray(tier.features) && tier.features.length > 4 && (
              <li className="text-xs text-muted-foreground pl-4">
                +{tier.features.length - 4} more
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface ResidentialLineItem {
  id: string;
  pricingItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

function ResidentialLineItemPicker({
  lineItems,
  onChange,
}: {
  lineItems: ResidentialLineItem[];
  onChange: (items: ResidentialLineItem[]) => void;
}) {
  const { formatMoney } = useCurrency();
  const [selectedPricingId, setSelectedPricingId] = useState("");

  const { data: pricingItems = [] } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const activeItems = pricingItems.filter((p) => p.isActive);
  const sortedItems = [...activeItems].sort((a, b) => {
    const catCmp = (a.category || "").localeCompare(b.category || "");
    if (catCmp !== 0) return catCmp;
    return (a.name || "").localeCompare(b.name || "");
  });

  const handleAddItem = (pricingId: string) => {
    const pricingItem = pricingItems.find((p) => p.id === pricingId);
    if (!pricingItem) return;
    const newItem: ResidentialLineItem = {
      id: `${Date.now()}-${Math.random()}`,
      pricingItemId: pricingItem.id,
      name: pricingItem.name,
      unitPrice: parseFloat(pricingItem.basePrice || "0"),
      quantity: 1,
    };
    onChange([...lineItems, newItem]);
    setSelectedPricingId("");
  };

  const handleUpdateItem = (id: string, field: "unitPrice" | "quantity", value: number) => {
    onChange(lineItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleRemoveItem = (id: string) => {
    onChange(lineItems.filter((item) => item.id !== id));
  };

  const subtotal = lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return (
    <div className="space-y-3" data-testid="residential-line-item-picker">
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <Select
            value={selectedPricingId}
            onValueChange={(val) => {
              setSelectedPricingId(val);
              handleAddItem(val);
            }}
          >
            <SelectTrigger data-testid="select-add-service">
              <SelectValue placeholder="Select a service to add..." />
              <ChevronDown className="h-4 w-4 opacity-50" />
            </SelectTrigger>
            <SelectContent>
              {sortedItems.length === 0 ? (
                <SelectItem value="_empty" disabled>
                  No active services found
                </SelectItem>
              ) : (
                sortedItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span>{item.name}</span>
                    <span className="ml-2 text-muted-foreground text-xs">
                      {formatMoney(parseFloat(item.basePrice || "0"))}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Service</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">
                  Unit Price
                </th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground w-20">Qty</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground w-24">
                  Total
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lineItems.map((item) => (
                <tr key={item.id} data-testid={`line-item-row-${item.id}`}>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">
                    <Input
                      data-testid={`input-unit-price-${item.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-7 text-right text-sm w-24 ml-auto"
                      value={item.unitPrice}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      data-testid={`input-quantity-${item.id}`}
                      type="number"
                      step="1"
                      min="1"
                      className="h-7 text-right text-sm w-16 ml-auto"
                      value={item.quantity}
                      onChange={(e) =>
                        handleUpdateItem(item.id, "quantity", parseInt(e.target.value) || 1)
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    <span data-testid={`text-line-total-${item.id}`}>
                      {formatMoney(item.unitPrice * item.quantity)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      data-testid={`button-remove-line-item-${item.id}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveItem(item.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-right">
                  Subtotal
                </td>
                <td className="px-3 py-2 text-right font-bold text-green-700 dark:text-green-400">
                  <span data-testid="text-line-items-subtotal">{formatMoney(subtotal)}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {lineItems.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
          No services added yet. Select a service above to build this quote.
        </p>
      )}
    </div>
  );
}

export default function Quotes() {
  const { toast } = useToast();
  const { formatMoney } = useCurrency();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [prefilledContactId, setPrefilledContactId] = useState<string | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const searchString = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("create") === "true") {
      setEditingQuote(null);
      const cid = params.get("contactId") || null;
      setPrefilledContactId(cid);
      setDialogOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchString]);
  const [sendQuoteId, setSendQuoteId] = useState<string | null>(null);
  const [sendVia, setSendVia] = useState("email");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: allQuotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["/api/quotes"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/contacts?all=true", { credentials: "include", headers });
      return r.ok ? r.json() : [];
    },
  });

  const filteredQuotes = useMemo(() => {
    let result = allQuotes;
    if (statusFilter !== "all") result = result.filter((q) => q.status === statusFilter);
    if (typeFilter !== "all") result = result.filter((q) => q.type === typeFilter);
    if (contactFilter !== "all") result = result.filter((q) => q.contactId === contactFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(
        (q) =>
          q.contactName?.toLowerCase().includes(s) ||
          q.quoteNumber?.toLowerCase().includes(s) ||
          q.contactEmail?.toLowerCase().includes(s) ||
          q.propertyAddress?.toLowerCase().includes(s)
      );
    }
    return result;
  }, [allQuotes, statusFilter, typeFilter, contactFilter, searchTerm]);

  const stats = useMemo(
    () => ({
      total: allQuotes.length,
      draft: allQuotes.filter((q) => q.status === "draft").length,
      sent: allQuotes.filter((q) => q.status === "sent").length,
      accepted: allQuotes.filter((q) => q.status === "accepted").length,
      totalValue: allQuotes
        .filter((q) => q.status === "accepted")
        .reduce((sum, q) => sum + parseFloat(q.selectedPrice || q.premiumPrice || "0"), 0),
    }),
    [allQuotes]
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/quotes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Quote deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ id, sendVia }: { id: string; sendVia: string }) => {
      const res = await apiRequest("POST", `/api/quotes/${id}/send`, { sendVia });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setSendDialogOpen(false);
      const sentVia = data.sent?.join(" & ") || "unknown";
      toast({ title: "Quote sent", description: `Sent via ${sentVia}` });
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const handleDownload = useCallback(
    async (quoteId: string, format: "pdf" | "docx") => {
      try {
        setDownloadMenuId(null);
        const res = await fetch(`/api/quotes/${quoteId}/download/${format}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
        const filename = filenameMatch
          ? filenameMatch[1]
          : `quote.${format === "pdf" ? "pdf" : "docx"}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: `Downloaded as ${format.toUpperCase()}` });
      } catch (err: any) {
        toast({ title: "Download failed", description: err.message, variant: "destructive" });
      }
    },
    [toast]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Quotes & Proposals
          </h1>
          <p className="text-muted-foreground text-sm">
            Create and manage service quotes for residential and commercial clients
          </p>
        </div>
        <Button
          data-testid="button-create-quote"
          onClick={() => {
            setEditingQuote(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> New Quote
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-stat-total">
                  {stats.total}
                </p>
                <p className="text-xs text-muted-foreground">Total Quotes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-stat-pending">
                  {stats.sent}
                </p>
                <p className="text-xs text-muted-foreground">Awaiting Response</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-stat-accepted">
                  {stats.accepted}
                </p>
                <p className="text-xs text-muted-foreground">Accepted</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-stat-value">
                  {formatMoney(stats.totalValue)}
                </p>
                <p className="text-xs text-muted-foreground">Won Value/visit</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search by name, quote #, email..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">
              All
            </TabsTrigger>
            <TabsTrigger value="draft" data-testid="tab-draft">
              Draft
            </TabsTrigger>
            <TabsTrigger value="sent" data-testid="tab-sent">
              Sent
            </TabsTrigger>
            <TabsTrigger value="accepted" data-testid="tab-accepted">
              Accepted
            </TabsTrigger>
            <TabsTrigger value="declined" data-testid="tab-declined">
              Declined
            </TabsTrigger>
            <TabsTrigger value="expired" data-testid="tab-expired">
              Expired
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="residential">Residential</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={contactFilter} onValueChange={setContactFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-contact-filter">
            <SelectValue placeholder="All Contacts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contacts</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="p-12 text-center">
              <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No quotes found</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setEditingQuote(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Create your first quote
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQuotes.map((quote) => {
                  const cfg = statusConfig[quote.status] || statusConfig.draft;
                  return (
                    <TableRow key={quote.id} data-testid={`row-quote-${quote.id}`}>
                      <TableCell
                        className="font-mono text-sm"
                        data-testid={`text-quote-number-${quote.id}`}
                      >
                        {quote.quoteNumber}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{quote.contactName || "—"}</p>
                          {quote.contactEmail && (
                            <p className="text-xs text-muted-foreground">{quote.contactEmail}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {quote.type === "residential" ? (
                            <Home className="h-3 w-3 mr-1" />
                          ) : (
                            <Building2 className="h-3 w-3 mr-1" />
                          )}
                          {quote.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {frequencyLabels[quote.frequency || ""] || quote.frequency || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {quote.selectedPrice ? (
                            <span className="font-semibold text-green-700">
                              {formatMoney(parseFloat(quote.selectedPrice))}/visit
                            </span>
                          ) : (
                            <span>
                              {formatMoney(parseFloat(quote.essentialPrice || "0"))}–
                              {formatMoney(parseFloat(quote.deluxePrice || "0"))}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} data-testid={`badge-status-${quote.id}`}>
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {quote.createdAt ? new Date(quote.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-preview-${quote.id}`}
                            onClick={() => {
                              setPreviewQuoteId(quote.id);
                              setPreviewOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <div className="relative">
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid={`button-download-${quote.id}`}
                              onClick={() =>
                                setDownloadMenuId(downloadMenuId === quote.id ? null : quote.id)
                              }
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {downloadMenuId === quote.id && (
                              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border bg-white dark:bg-gray-900 shadow-lg py-1">
                                <button
                                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"
                                  data-testid={`button-download-pdf-${quote.id}`}
                                  onClick={() => handleDownload(quote.id, "pdf")}
                                >
                                  <FileText className="h-3.5 w-3.5" /> Download PDF
                                </button>
                                <button
                                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"
                                  data-testid={`button-download-docx-${quote.id}`}
                                  onClick={() => handleDownload(quote.id, "docx")}
                                >
                                  <FileText className="h-3.5 w-3.5" /> Download Word
                                </button>
                              </div>
                            )}
                          </div>
                          {(quote.status === "draft" || quote.status === "sent") && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-edit-${quote.id}`}
                                onClick={() => {
                                  setEditingQuote(quote);
                                  setDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-send-${quote.id}`}
                                onClick={() => {
                                  setSendQuoteId(quote.id);
                                  setSendDialogOpen(true);
                                }}
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {quote.status !== "accepted" &&
                            (deleteConfirmId === quote.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  data-testid={`button-delete-confirm-${quote.id}`}
                                  disabled={deleteMutation.isPending}
                                  onClick={() => {
                                    deleteMutation.mutate(quote.id);
                                    setDeleteConfirmId(null);
                                  }}
                                >
                                  {deleteMutation.isPending ? "Deleting..." : "Confirm"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`button-delete-cancel-${quote.id}`}
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-${quote.id}`}
                                onClick={() => setDeleteConfirmId(quote.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateEditQuoteDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setPrefilledContactId(null);
        }}
        quote={editingQuote}
        contacts={contacts}
        prefilledContactId={prefilledContactId}
      />

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Quote</DialogTitle>
            <DialogDescription>Choose how to deliver this quote to the client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={sendVia} onValueChange={setSendVia}>
              <SelectTrigger data-testid="select-send-via">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email Only</SelectItem>
                <SelectItem value="sms">SMS Only</SelectItem>
                <SelectItem value="both">Email & SMS</SelectItem>
              </SelectContent>
            </Select>
            <Button
              data-testid="button-confirm-send"
              className="w-full"
              disabled={sendMutation.isPending}
              onClick={() => sendQuoteId && sendMutation.mutate({ id: sendQuoteId, sendVia })}
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Quote
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Quote Preview</DialogTitle>
              {previewQuoteId && (
                <div className="flex gap-2 mr-6">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-preview-download-pdf"
                    onClick={() => handleDownload(previewQuoteId, "pdf")}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-preview-download-docx"
                    onClick={() => handleDownload(previewQuoteId, "docx")}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Word
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          {previewQuoteId && (
            <iframe
              src={`/api/quotes/${previewQuoteId}/preview`}
              className="w-full h-[70vh] border rounded"
              title="Quote Preview"
              data-testid="iframe-preview"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateEditQuoteDialog({
  open,
  onOpenChange,
  quote,
  contacts,
  prefilledContactId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote | null;
  contacts: Contact[];
  prefilledContactId?: string | null;
}) {
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const { formatMoney } = useCurrency();
  const isEdit = !!quote;

  const [quoteType, setQuoteType] = useState<"residential" | "commercial">(
    quote?.type || "residential"
  );
  const [quoteNumber, setQuoteNumber] = useState(quote?.quoteNumber || "");
  const [contactId, setContactId] = useState(quote?.contactId || "");
  const [propertyId, setPropertyId] = useState(quote?.propertyId || "");
  const [contactName, setContactName] = useState(quote?.contactName || "");
  const [contactEmail, setContactEmail] = useState(quote?.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(quote?.contactPhone || "");
  const [propertyAddress, setPropertyAddress] = useState(quote?.propertyAddress || "");
  const [propertyCity, setPropertyCity] = useState("");
  const [propertyState, setPropertyState] = useState("");
  const [propertyZip, setPropertyZip] = useState("");
  const [expiresAt, setExpiresAt] = useState(
    quote?.expiresAt ? toLocalDateString(new Date(quote.expiresAt), tz) : ""
  );
  const [dogCount, setDogCount] = useState<number | string>(quote?.dogCount || 2);
  const [yardSize, setYardSize] = useState(quote?.yardSize || "small");
  const [stationCount, setStationCount] = useState<number | string>(quote?.stationCount ?? 4);
  const [commonAreaMinutes, setCommonAreaMinutes] = useState<number | string>(
    quote?.commonAreaMinutes || 30
  );
  const [timePerStation, setTimePerStation] = useState<number | string>(
    quote?.timePerStation || 10
  );
  const [mileageDistance, setMileageDistance] = useState<number | string>(
    parseFloat(String(quote?.mileageDistance || 0))
  );
  const [dumpFee, setDumpFee] = useState<number | string>(parseFloat(String(quote?.dumpFee || 25)));
  const [crewSize, setCrewSize] = useState<number | string>(quote?.crewSize || 1);
  const [siteSqft, setSiteSqft] = useState<number | string>(quote?.siteSqft || 0);
  const [isInitialClean, setIsInitialClean] = useState(false);
  const [markupPct, setMarkupPct] = useState(20);
  const [overrideInitialClean, setOverrideInitialClean] = useState("");
  const [frequency, setFrequency] = useState(
    quote?.frequency || (quoteType === "residential" ? "weekly" : "1x_weekly")
  );
  const [isFirstTime, setIsFirstTime] = useState(quote?.isFirstTime !== false);
  const [notes, setNotes] = useState(quote?.notes || "");
  const [internalNotes, setInternalNotes] = useState(quote?.internalNotes || "");
  const [livePricing, setLivePricing] = useState<TierPricing | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [overrideEssential, setOverrideEssential] = useState("");
  const [overridePremium, setOverridePremium] = useState("");
  const [overrideDeluxe, setOverrideDeluxe] = useState("");
  const [customEssentialFeatures, setCustomEssentialFeatures] = useState<string[]>([]);
  const [customPremiumFeatures, setCustomPremiumFeatures] = useState<string[]>([]);
  const [customDeluxeFeatures, setCustomDeluxeFeatures] = useState<string[]>([]);
  const [featuresCustomized, setFeaturesCustomized] = useState(false);
  const [suppressNotifications, setSuppressNotifications] = useState(false);
  const [editingFeatures, setEditingFeatures] = useState(false);
  const [resLineItems, setResLineItems] = useState<ResidentialLineItem[]>([]);

  useEffect(() => {
    if (!open) setSuppressNotifications(false);
  }, [open]);
  const [quoteImages, setQuoteImages] = useState<
    { url: string; caption: string; sqft?: number | null }[]
  >((quote?.images as { url: string; caption: string; sqft?: number | null }[]) || []);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [measurements, setMeasurements] = useState<{ polygon: number[][]; sqft: number }[]>([]);
  const [showMeasureTool, setShowMeasureTool] = useState(false);

  useEffect(() => {
    if (quote) {
      setQuoteType(quote.type || "residential");
      setContactId(quote.contactId || "");
      setPropertyId(quote.propertyId || "");
      setContactName(quote.contactName || "");
      setContactEmail(quote.contactEmail || "");
      setContactPhone(quote.contactPhone || "");
      const addrParts = (quote.propertyAddress || "").split(",").map((s: string) => s.trim());
      setPropertyAddress(addrParts[0] || "");
      setPropertyCity(addrParts[1] || "");
      const stateZip = (addrParts[2] || "").split(/\s+/);
      setPropertyState(stateZip[0] || "");
      setPropertyZip(stateZip.slice(1).join(" ") || addrParts[3] || "");
      setExpiresAt(quote.expiresAt ? toLocalDateString(new Date(quote.expiresAt), tz) : "");
      setDogCount(quote.dogCount || 2);
      setYardSize(quote.yardSize || "small");
      setStationCount(quote.stationCount ?? 4);
      setCommonAreaMinutes(quote.commonAreaMinutes || 30);
      setTimePerStation(quote.timePerStation || 10);
      setMileageDistance(parseFloat(String(quote.mileageDistance || 0)));
      setDumpFee(parseFloat(String(quote.dumpFee || 25)));
      setCrewSize(quote.crewSize || 1);
      setSiteSqft(quote.siteSqft || 0);
      setFrequency(quote.frequency || "weekly");
      setIsFirstTime(quote.isFirstTime !== false);
      setNotes(quote.notes || "");
      setInternalNotes(quote.internalNotes || "");
      setQuoteImages(
        (quote.images as { url: string; caption: string; sqft?: number | null }[]) || []
      );
      const savedLineItems = quote.lineItems;
      if (savedLineItems && Array.isArray(savedLineItems)) {
        setResLineItems(
          savedLineItems.map((item, idx) => ({
            id: `loaded-${idx}-${Math.random()}`,
            ...item,
          }))
        );
      } else {
        setResLineItems([]);
      }
      const savedInitialClean = parseFloat(String(quote.initialCleanFee || 0));
      setOverrideInitialClean(savedInitialClean > 0 ? savedInitialClean.toFixed(2) : "");
      if (quote.essentialFeatures) {
        setCustomEssentialFeatures(
          Array.isArray(quote.essentialFeatures) ? (quote.essentialFeatures as string[]) : []
        );
        setCustomPremiumFeatures(
          Array.isArray(quote.premiumFeatures) ? (quote.premiumFeatures as string[]) : []
        );
        setCustomDeluxeFeatures(
          Array.isArray(quote.deluxeFeatures) ? (quote.deluxeFeatures as string[]) : []
        );
        setFeaturesCustomized(true);
      }
    } else {
      setQuoteType("residential");
      setContactId(prefilledContactId || "");
      setPropertyId("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setPropertyAddress("");
      setPropertyCity("");
      setPropertyState("");
      setPropertyZip("");
      setExpiresAt("");
      setDogCount(2);
      setYardSize("small");
      setStationCount(4);
      setCommonAreaMinutes(30);
      setFrequency("weekly");
      setIsFirstTime(true);
      setNotes("");
      setInternalNotes("");
      setManualOverride(false);
      setLivePricing(null);
      setQuoteImages([]);
      setMeasurements([]);
      setShowMeasureTool(false);
      setAddressCoords(null);
      setCustomEssentialFeatures([]);
      setCustomPremiumFeatures([]);
      setCustomDeluxeFeatures([]);
      setFeaturesCustomized(false);
      setEditingFeatures(false);
      setOverrideInitialClean("");
      setResLineItems([]);
    }
  }, [quote, open]);

  const pricingParams = useMemo(() => {
    if (quoteType === "residential") {
      return `type=residential&dogCount=${dogCount}&yardSize=${yardSize}&frequency=${frequency}&isFirstTime=${isFirstTime}`;
    }
    return `type=commercial&stationCount=${stationCount}&commonAreaMinutes=${commonAreaMinutes}&frequency=${frequency}&timePerStation=${timePerStation}&mileageDistance=${mileageDistance}&dumpFee=${dumpFee}&crewSize=${crewSize}&siteSqft=${siteSqft}&isInitialClean=${isInitialClean}&markupPct=${markupPct}`;
  }, [
    quoteType,
    dogCount,
    yardSize,
    stationCount,
    commonAreaMinutes,
    frequency,
    isFirstTime,
    timePerStation,
    mileageDistance,
    dumpFee,
    crewSize,
    siteSqft,
    isInitialClean,
    markupPct,
  ]);

  const {
    data: calculatedPricing,
    isError: isPricingError,
    error: pricingError,
    refetch: refetchPricing,
    isFetching: isPricingFetching,
  } = useQuery<TierPricing>({
    queryKey: ["/api/quotes/calculate-pricing", pricingParams],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/calculate-pricing?${pricingParams}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Pricing request failed (${res.status})`);
      }
      return res.json();
    },
    enabled: open && quoteType === "commercial",
    retry: 1,
  });

  useEffect(() => {
    if (calculatedPricing) {
      setLivePricing(calculatedPricing);
      if (!featuresCustomized) {
        setCustomEssentialFeatures(
          Array.isArray(calculatedPricing.essentialFeatures)
            ? calculatedPricing.essentialFeatures
            : []
        );
        setCustomPremiumFeatures(
          Array.isArray(calculatedPricing.premiumFeatures) ? calculatedPricing.premiumFeatures : []
        );
        setCustomDeluxeFeatures(
          Array.isArray(calculatedPricing.deluxeFeatures) ? calculatedPricing.deluxeFeatures : []
        );
      }
    }
  }, [calculatedPricing, featuresCustomized]);

  useEffect(() => {
    if (isPricingError && !livePricing) {
      setManualOverride(true);
    }
  }, [isPricingError, livePricing]);

  const { data: contactProperties } = useQuery<Property[]>({
    queryKey: ["/api/properties", { contactId }],
    queryFn: async () => {
      if (!contactId) return [];
      const res = await fetch(`/api/properties?contactId=${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId && open,
  });

  const handleContactSelect = (id: string) => {
    setContactId(id);
    setPropertyId("");
    const contact = contacts.find((c) => c.id === id);
    if (contact) {
      setContactName(`${contact.firstName} ${contact.lastName}`.trim());
      setContactEmail(contact.email || "");
      setContactPhone(contact.phone || "");
    }
  };

  useEffect(() => {
    if (!quote && prefilledContactId && contacts.length > 0) {
      const contact = contacts.find((c) => c.id === prefilledContactId);
      if (contact) {
        setContactName(`${contact.firstName} ${contact.lastName}`.trim());
        setContactEmail(contact.email || "");
        setContactPhone(contact.phone || "");
      }
    }
  }, [prefilledContactId, contacts, quote]);

  const handlePropertySelect = (id: string) => {
    setPropertyId(id);
    const prop = contactProperties?.find((p) => p.id === id);
    if (prop) {
      setPropertyAddress(prop.streetAddress || "");
      setPropertyCity(prop.city || "");
      setPropertyState(prop.state || "");
      setPropertyZip(prop.zipCode || "");
      const lat = prop.latitude ? parseFloat(String(prop.latitude)) : null;
      const lng = prop.longitude ? parseFloat(String(prop.longitude)) : null;
      if (lat && lng) {
        setAddressCoords({ lat, lng });
      }
    }
  };

  const handleAddressSelect = useCallback(
    (parsed: {
      streetAddress: string;
      city: string;
      state: string;
      zipCode: string;
      latitude: string;
      longitude: string;
    }) => {
      if (parsed.streetAddress) setPropertyAddress(parsed.streetAddress);
      setPropertyCity(parsed.city || "");
      setPropertyState(parsed.state || "");
      setPropertyZip(parsed.zipCode || "");
      if (parsed.latitude && parsed.longitude) {
        setAddressCoords({ lat: parseFloat(parsed.latitude), lng: parseFloat(parsed.longitude) });
      } else {
        setAddressCoords(null);
      }
      setMeasurements([]);
      setShowMeasureTool(false);
    },
    []
  );

  const handleGenerateYardImage = useCallback(
    async (polygon: number[][], sqft: number, lat: number, lng: number) => {
      if (generatingImage) return;
      setGeneratingImage(true);
      try {
        const res = await apiRequest("POST", "/api/quotes/generate-yard-image", {
          polygon,
          lat,
          lng,
          sqft,
          zoom: 19,
        });
        const data = await res.json();
        setQuoteImages((prev) => [
          ...prev,
          { url: data.url, caption: data.caption, sqft: data.sqft },
        ]);
        toast({ title: "Measurement saved & image captured" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to generate image";
        toast({ title: "Error", description: msg, variant: "destructive" });
      } finally {
        setGeneratingImage(false);
      }
    },
    [generatingImage, toast]
  );

  const handleMeasurementSave = useCallback(
    (polygon: number[][], areaSqft: number) => {
      setMeasurements((prev) => {
        const updated = [...prev, { polygon, sqft: areaSqft }];
        if (quoteType === "residential") {
          const totalSqft = updated.reduce((sum, m) => sum + m.sqft, 0);
          const ACRE = 43560;
          let tier: string;
          if (totalSqft < ACRE * 0.25) tier = "small";
          else if (totalSqft < ACRE * 0.5) tier = "medium";
          else if (totalSqft < ACRE) tier = "large";
          else tier = "estate";
          setYardSize(tier);
        }
        return updated;
      });
      if (quoteType === "commercial") {
        setSiteSqft((prev) => Number(prev || 0) + Math.round(areaSqft));
      }
      setShowMeasureTool(false);
      if (addressCoords) {
        handleGenerateYardImage(polygon, areaSqft, addressCoords.lat, addressCoords.lng);
      }
    },
    [addressCoords, handleGenerateYardImage, quoteType, setYardSize]
  );

  const removeImage = (idx: number) => {
    setQuoteImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (isEdit) {
        const res = await apiRequest("PATCH", `/api/quotes/${quote!.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/quotes", data);
      return res.json();
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      if (!isEdit) {
        const cId = variables.contactId as string | null;
        if (cId) {
          const contact = contacts.find((c) => c.id === cId);
          if (contact?.status === "lead") {
            try {
              await apiRequest("PATCH", `/api/contacts/${cId}`, { status: "estimate" });
              queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
              queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
              toast({
                title: "Quote created",
                description: `${contact.firstName}'s status updated to Estimate.`,
              });
            } catch {
              toast({ title: "Quote created" });
            }
          } else {
            toast({ title: "Quote created" });
          }
        } else {
          toast({ title: "Quote created" });
        }
      } else {
        toast({ title: "Quote updated" });
      }
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const commonFields: Record<string, unknown> = {
      type: quoteType,
      quoteNumber: quoteNumber || null,
      contactId: contactId || null,
      propertyId: propertyId || null,
      contactName,
      contactEmail,
      contactPhone,
      propertyAddress: [propertyAddress, propertyCity, propertyState, propertyZip]
        .filter(Boolean)
        .join(", "),
      frequency,
      notes: notes || null,
      internalNotes: internalNotes || null,
      isFirstTime,
      images: quoteImages.length > 0 ? quoteImages : null,
      expiresAt: expiresAt || null,
    };

    if (quoteType === "residential") {
      const subtotal = resLineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const subtotalStr = subtotal.toFixed(2);
      const data: Record<string, unknown> = {
        ...commonFields,
        dogCount: Number(dogCount) || 1,
        yardSize,
        essentialPrice: subtotalStr,
        premiumPrice: subtotalStr,
        deluxePrice: subtotalStr,
        initialCleanFee: overrideInitialClean || "0.00",
        essentialFeatures: [],
        premiumFeatures: [],
        deluxeFeatures: [],
        pricingBreakdown: null,
        lineItems:
          resLineItems.length > 0
            ? resLineItems.map(({ pricingItemId, name, unitPrice, quantity }) => ({
                pricingItemId,
                name,
                unitPrice,
                quantity,
              }))
            : null,
      };
      if (!isEdit) data.suppressNotifications = suppressNotifications;
      createMutation.mutate(data);
      return;
    }

    // Commercial: existing tier pricing logic
    const p = livePricing;
    const usingManualOnly = !p && manualOverride;

    if (!p && !usingManualOnly) return;
    if (usingManualOnly && (!overrideEssential || !overridePremium || !overrideDeluxe)) return;

    const data: Record<string, unknown> = {
      ...commonFields,
      essentialPrice: usingManualOnly
        ? overrideEssential
        : manualOverride && overrideEssential
          ? overrideEssential
          : p!.essential.toFixed(2),
      premiumPrice: usingManualOnly
        ? overridePremium
        : manualOverride && overridePremium
          ? overridePremium
          : p!.premium.toFixed(2),
      deluxePrice: usingManualOnly
        ? overrideDeluxe
        : manualOverride && overrideDeluxe
          ? overrideDeluxe
          : p!.deluxe.toFixed(2),
      initialCleanFee: overrideInitialClean || (p ? p.initialCleanFee.toFixed(2) : "0.00"),
      essentialFeatures:
        customEssentialFeatures.length > 0 ? customEssentialFeatures : p ? p.essentialFeatures : [],
      premiumFeatures:
        customPremiumFeatures.length > 0 ? customPremiumFeatures : p ? p.premiumFeatures : [],
      deluxeFeatures:
        customDeluxeFeatures.length > 0 ? customDeluxeFeatures : p ? p.deluxeFeatures : [],
      pricingBreakdown: p ? p.breakdown : null,
      lineItems: null,
      stationCount: Number(stationCount) || 0,
      commonAreaMinutes: Number(commonAreaMinutes) || 0,
      timePerStation: Number(timePerStation) || 10,
      mileageDistance: (Number(mileageDistance) || 0).toFixed(2),
      dumpFee: (Number(dumpFee) || 0).toFixed(2),
      crewSize: Number(crewSize) || 1,
      siteSqft: Number(siteSqft) || 0,
    };

    if (!isEdit) data.suppressNotifications = suppressNotifications;
    createMutation.mutate(data);
  };

  const resFrequencies = [
    { value: "weekly", label: "Weekly" },
    { value: "biweekly", label: "Bi-weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "onetime", label: "One-time" },
  ];

  const comFrequencies = [
    { value: "1x_weekly", label: "Weekly" },
    { value: "2x_weekly", label: "2x Weekly" },
    { value: "3x_weekly", label: "3x Weekly" },
    { value: "monthly", label: "Monthly" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {isEdit ? "Edit Quote" : "New Quote"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the quote details below."
              : "Fill in the details to generate a service quote with tiered pricing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isEdit && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Quote Type</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  data-testid="button-type-residential"
                  type="button"
                  className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
                    quoteType === "residential"
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => {
                    setQuoteType("residential");
                    setFrequency("weekly");
                  }}
                >
                  <Home className="h-6 w-6 text-green-600" />
                  <div className="text-left">
                    <p className="font-semibold text-sm">Residential</p>
                    <p className="text-xs text-muted-foreground">Individual homeowners</p>
                  </div>
                </button>
                <button
                  data-testid="button-type-commercial"
                  type="button"
                  className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
                    quoteType === "commercial"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => {
                    setQuoteType("commercial");
                    setFrequency("1x_weekly");
                  }}
                >
                  <Building2 className="h-6 w-6 text-blue-600" />
                  <div className="text-left">
                    <p className="font-semibold text-sm">Commercial</p>
                    <p className="text-xs text-muted-foreground">HOAs, apartments, parks</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          <div>
            <Label>Quote Number</Label>
            <Input
              data-testid="input-quote-number"
              value={quoteNumber}
              onChange={(e) => setQuoteNumber(e.target.value)}
              placeholder={isEdit ? "" : "Auto-generated if left blank"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={handleContactSelect}>
                <SelectTrigger data-testid="select-contact">
                  <SelectValue placeholder="Select existing contact..." />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input
                data-testid="input-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                data-testid="input-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                data-testid="input-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contactId && contactProperties && contactProperties.length > 0 && (
              <div>
                <Label>Property</Label>
                <Select value={propertyId} onValueChange={handlePropertySelect}>
                  <SelectTrigger data-testid="select-property">
                    <SelectValue placeholder="Select property..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contactProperties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.streetAddress}
                        {p.city ? `, ${p.city}` : ""}
                        {p.state ? `, ${p.state}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div
              className={
                contactId && contactProperties && contactProperties.length > 0
                  ? ""
                  : "md:col-span-2"
              }
            >
              <Label>Street Address</Label>
              <AddressAutocomplete
                data-testid="input-address"
                value={propertyAddress}
                onChange={setPropertyAddress}
                onSelect={handleAddressSelect}
                placeholder="Start typing an address..."
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>City</Label>
              <Input
                data-testid="input-city"
                value={propertyCity}
                onChange={(e) => setPropertyCity(e.target.value)}
                placeholder="City"
              />
            </div>
            <div>
              <Label>State</Label>
              <Input
                data-testid="input-state"
                value={propertyState}
                onChange={(e) => setPropertyState(e.target.value)}
                placeholder="ST"
              />
            </div>
            <div>
              <Label>ZIP Code</Label>
              <Input
                data-testid="input-zip"
                value={propertyZip}
                onChange={(e) => setPropertyZip(e.target.value)}
                placeholder="12345"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Expiration Date</Label>
              <Input
                data-testid="input-expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank for 30-day default when sent
              </p>
            </div>
          </div>

          {quoteType === "residential" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label>Number of Dogs</Label>
                <Input
                  data-testid="input-dog-count"
                  type="number"
                  min={1}
                  max={20}
                  value={dogCount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDogCount(v === "" ? "" : parseInt(v) || "");
                  }}
                  onBlur={() => {
                    if (dogCount === "" || dogCount === 0) setDogCount(1);
                  }}
                />
              </div>
              <div>
                <Label>Yard Size</Label>
                <Select value={yardSize} onValueChange={setYardSize}>
                  <SelectTrigger data-testid="select-yard-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small (&lt; ¼ acre)</SelectItem>
                    <SelectItem value="medium">Medium (¼–½ acre)</SelectItem>
                    <SelectItem value="large">Large (½–1 acre)</SelectItem>
                    <SelectItem value="estate">Estate (1+ acre)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger data-testid="select-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {resFrequencies.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  data-testid="switch-first-time"
                  checked={isFirstTime}
                  onCheckedChange={setIsFirstTime}
                />
                <Label className="text-sm">First-time clean</Label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Waste Stations</Label>
                  <Input
                    data-testid="input-station-count"
                    type="number"
                    min={0}
                    max={100}
                    value={stationCount}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStationCount(v === "" ? "" : (parseInt(v) ?? ""));
                    }}
                    onBlur={() => {
                      if (stationCount === "") setStationCount(0);
                    }}
                  />
                </div>
                <div>
                  <Label>Time/Station (min)</Label>
                  <Input
                    data-testid="input-time-per-station"
                    type="number"
                    min={1}
                    max={60}
                    value={timePerStation}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTimePerStation(v === "" ? "" : parseInt(v) || "");
                    }}
                    onBlur={() => {
                      if (timePerStation === "" || timePerStation === 0) setTimePerStation(10);
                    }}
                  />
                </div>
                <div>
                  <Label>Common Area (min)</Label>
                  <Input
                    data-testid="input-common-area"
                    type="number"
                    min={0}
                    max={480}
                    value={commonAreaMinutes}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCommonAreaMinutes(v === "" ? "" : (parseInt(v) ?? ""));
                    }}
                    onBlur={() => {
                      if (commonAreaMinutes === "") setCommonAreaMinutes(0);
                    }}
                  />
                </div>
                <div>
                  <Label>Crew Size</Label>
                  <Input
                    data-testid="input-crew-size"
                    type="number"
                    min={1}
                    max={10}
                    value={crewSize}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCrewSize(v === "" ? "" : parseInt(v) || "");
                    }}
                    onBlur={() => {
                      if (crewSize === "" || crewSize === 0) setCrewSize(1);
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Round Trip Miles</Label>
                  <Input
                    data-testid="input-mileage"
                    type="number"
                    min={0}
                    step="0.1"
                    value={mileageDistance}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMileageDistance(v === "" ? "" : (parseFloat(v) ?? ""));
                    }}
                    onBlur={() => {
                      if (mileageDistance === "") setMileageDistance(0);
                    }}
                  />
                </div>
                <div>
                  <Label>Dump Fee ($/visit)</Label>
                  <Input
                    data-testid="input-dump-fee"
                    type="number"
                    min={0}
                    step="0.01"
                    value={dumpFee}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDumpFee(v === "" ? "" : (parseFloat(v) ?? ""));
                    }}
                    onBlur={() => {
                      if (dumpFee === "") setDumpFee(0);
                    }}
                  />
                </div>
                <div>
                  <Label>Site Area (sq ft)</Label>
                  <Input
                    data-testid="input-site-sqft"
                    type="number"
                    min={0}
                    value={siteSqft}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSiteSqft(v === "" ? "" : (parseInt(v) ?? ""));
                    }}
                    onBlur={() => {
                      if (siteSqft === "") setSiteSqft(0);
                    }}
                  />
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger data-testid="select-frequency-commercial">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {comFrequencies.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2 pt-5">
                  <Switch
                    data-testid="switch-initial-clean"
                    checked={isInitialClean}
                    onCheckedChange={setIsInitialClean}
                  />
                  <Label className="text-sm">Initial deep clean</Label>
                </div>
                <div>
                  <Label>Markup %</Label>
                  <Input
                    data-testid="input-markup-pct"
                    type="number"
                    min={0}
                    max={200}
                    step="1"
                    value={markupPct}
                    onChange={(e) => setMarkupPct(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {livePricing?.breakdown && (
                <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-1 text-sm">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Cost Breakdown (per visit)
                  </h4>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {stationCount} stations x{" "}
                      {formatMoney(livePricing.breakdown.stationRate ?? 0)}
                    </span>
                    <span className="font-medium">
                      {formatMoney(livePricing.breakdown.stationCost ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Labor ({livePricing.breakdown.totalLaborHours} hrs x {crewSize} crew @{" "}
                      {formatMoney(livePricing.breakdown.crewRate ?? 0)}/hr)
                    </span>
                    <span className="font-medium">
                      {formatMoney(livePricing.breakdown.laborCost ?? 0)}
                    </span>
                  </div>
                  {Number(mileageDistance) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Mileage ({mileageDistance} mi x $
                        {livePricing.breakdown.mileageRate?.toFixed(3)})
                      </span>
                      <span className="font-medium">
                        {formatMoney(livePricing.breakdown.mileageCost ?? 0)}
                      </span>
                    </div>
                  )}
                  {Number(dumpFee) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dump fee</span>
                      <span className="font-medium">{formatMoney(Number(dumpFee))}</span>
                    </div>
                  )}

                  <div className="border-t border-slate-300 dark:border-slate-600 pt-2 mt-2 flex justify-between font-semibold">
                    <span>Subtotal (Your Costs)</span>
                    <span>
                      {livePricing.breakdown.costSubtotal != null
                        ? formatMoney(livePricing.breakdown.costSubtotal)
                        : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between text-muted-foreground">
                    <span>Markup ({markupPct}%)</span>
                    <span>
                      +{" "}
                      {livePricing.breakdown.markupFee != null
                        ? formatMoney(livePricing.breakdown.markupFee)
                        : "—"}
                    </span>
                  </div>

                  <div className="border-t border-slate-400 dark:border-slate-500 pt-2 mt-1 flex justify-between font-bold text-base">
                    <span>Grand Total (per visit)</span>
                    <span className="text-green-700 dark:text-green-400">
                      {formatMoney(livePricing.essential)}
                    </span>
                  </div>

                  <div className="flex justify-between text-xs text-muted-foreground pt-1">
                    <span>Est. Monthly ({livePricing.breakdown.visitsPerMonth} visits)</span>
                    <span>
                      {livePricing.breakdown.monthlyEstimate != null
                        ? formatMoney(livePricing.breakdown.monthlyEstimate)
                        : "—"}
                    </span>
                  </div>
                  {isInitialClean && (
                    <div className="flex justify-between items-center text-xs text-amber-700 dark:text-amber-400 font-medium">
                      <span>Initial Deep Clean (one-time)</span>
                      <Input
                        data-testid="input-override-initial-clean"
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-24 h-6 text-xs text-right"
                        value={overrideInitialClean || livePricing.initialCleanFee.toFixed(2)}
                        onChange={(e) => setOverrideInitialClean(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {quoteType === "residential" && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Services</Label>
                <ResidentialLineItemPicker lineItems={resLineItems} onChange={setResLineItems} />
              </div>

              {isFirstTime && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between dark:bg-amber-950/30 dark:border-amber-800">
                  <span className="text-sm text-amber-800 dark:text-amber-300 font-semibold">
                    Initial Clean Fee (one-time)
                  </span>
                  <Input
                    data-testid="input-override-initial-clean-preview"
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-28 h-7 text-sm text-right"
                    placeholder="0.00"
                    value={overrideInitialClean}
                    onChange={(e) => setOverrideInitialClean(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {quoteType === "commercial" && isPricingError && !livePricing && (
            <div
              data-testid="alert-pricing-error"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800">Could not load pricing</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {(pricingError as Error)?.message || "Check your pricing settings or try again."}{" "}
                  Enter prices manually below to continue.
                </p>
              </div>
              <Button
                data-testid="button-retry-pricing"
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => refetchPricing()}
                disabled={isPricingFetching}
              >
                {isPricingFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
              </Button>
            </div>
          )}

          {quoteType === "commercial" && (livePricing || (isPricingError && !livePricing)) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Tier Pricing Preview</h3>
                {livePricing && (
                  <div className="flex items-center gap-2">
                    <Switch
                      data-testid="switch-manual-override"
                      checked={manualOverride}
                      onCheckedChange={setManualOverride}
                    />
                    <Label className="text-xs">Manual price override</Label>
                  </div>
                )}
              </div>

              {manualOverride || (isPricingError && !livePricing) ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs">Essential Price</Label>
                    <Input
                      data-testid="input-override-essential"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={
                        overrideEssential || (livePricing ? livePricing.essential.toFixed(2) : "")
                      }
                      onChange={(e) => setOverrideEssential(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Property Care Price</Label>
                    <Input
                      data-testid="input-override-premium"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={overridePremium || (livePricing ? livePricing.premium.toFixed(2) : "")}
                      onChange={(e) => setOverridePremium(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Deluxe Price</Label>
                    <Input
                      data-testid="input-override-deluxe"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={overrideDeluxe || (livePricing ? livePricing.deluxe.toFixed(2) : "")}
                      onChange={(e) => setOverrideDeluxe(e.target.value)}
                    />
                  </div>
                </div>
              ) : livePricing ? (
                <TierPreviewCards
                  pricing={{
                    ...livePricing,
                    essentialFeatures:
                      customEssentialFeatures.length > 0
                        ? customEssentialFeatures
                        : livePricing.essentialFeatures,
                    premiumFeatures:
                      customPremiumFeatures.length > 0
                        ? customPremiumFeatures
                        : livePricing.premiumFeatures,
                    deluxeFeatures:
                      customDeluxeFeatures.length > 0
                        ? customDeluxeFeatures
                        : livePricing.deluxeFeatures,
                  }}
                />
              ) : null}

              {livePricing && (
                <div className="flex justify-end">
                  <Button
                    data-testid="button-edit-features"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingFeatures(!editingFeatures)}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    {editingFeatures ? "Done Editing Packages" : "Edit Packages"}
                  </Button>
                </div>
              )}

              {editingFeatures && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border rounded-lg p-4 bg-muted/30">
                  {(
                    [
                      {
                        label: "Essential",
                        features: customEssentialFeatures,
                        setFeatures: setCustomEssentialFeatures,
                      },
                      {
                        label: "Property Care",
                        features: customPremiumFeatures,
                        setFeatures: setCustomPremiumFeatures,
                      },
                      {
                        label: "Deluxe",
                        features: customDeluxeFeatures,
                        setFeatures: setCustomDeluxeFeatures,
                      },
                    ] as const
                  ).map(({ label, features, setFeatures }) => (
                    <div key={label} className="space-y-2">
                      <Label className="text-xs font-semibold">{label} Features</Label>
                      {features.map((f, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <Input
                            data-testid={`input-feature-${label.toLowerCase().replace(/\s/g, "-")}-${i}`}
                            value={f}
                            onChange={(e) => {
                              const updated = [...features];
                              updated[i] = e.target.value;
                              setFeatures(updated);
                              setFeaturesCustomized(true);
                            }}
                            className="text-xs h-7"
                          />
                          <button
                            data-testid={`button-remove-feature-${label.toLowerCase().replace(/\s/g, "-")}-${i}`}
                            type="button"
                            onClick={() => {
                              setFeatures(features.filter((_, j) => j !== i));
                              setFeaturesCustomized(true);
                            }}
                            className="text-red-500 hover:text-red-700 shrink-0"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button
                        data-testid={`button-add-feature-${label.toLowerCase().replace(/\s/g, "-")}`}
                        variant="ghost"
                        size="sm"
                        className="text-xs h-6 w-full"
                        onClick={() => {
                          setFeatures([...features, ""]);
                          setFeaturesCustomized(true);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Feature
                      </Button>
                    </div>
                  ))}
                  <div className="col-span-full flex justify-end">
                    <Button
                      data-testid="button-reset-features"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        if (livePricing) {
                          setCustomEssentialFeatures(livePricing.essentialFeatures);
                          setCustomPremiumFeatures(livePricing.premiumFeatures);
                          setCustomDeluxeFeatures(livePricing.deluxeFeatures);
                          setFeaturesCustomized(false);
                        }
                      }}
                    >
                      Reset to Defaults
                    </Button>
                  </div>
                </div>
              )}

              {livePricing &&
                (livePricing.initialCleanFee > 0 || isFirstTime || isInitialClean) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm text-amber-800 font-semibold">
                      Initial Clean Fee (one-time)
                    </span>
                    <Input
                      data-testid="input-override-initial-clean-preview"
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28 h-7 text-sm text-right"
                      value={overrideInitialClean || livePricing.initialCleanFee.toFixed(2)}
                      onChange={(e) => setOverrideInitialClean(e.target.value)}
                    />
                  </div>
                )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Yard Measurements</Label>
              {addressCoords && !showMeasureTool && (
                <Button
                  data-testid="button-open-measure-tool"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMeasureTool(true)}
                >
                  <Ruler className="h-3 w-3 mr-1" />
                  {measurements.length > 0 ? "Add Measurement" : "Measure Yard"}
                </Button>
              )}
            </div>
            {measurements.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {measurements.map((m, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2.5 py-1 text-xs"
                    data-testid={`measurement-${idx}`}
                  >
                    <Ruler className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{m.sqft.toLocaleString()} sq ft</span>
                    <button
                      type="button"
                      className="ml-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setMeasurements((prev) => prev.filter((_, i) => i !== idx));
                        setQuoteImages((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      data-testid={`button-remove-measurement-${idx}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <span className="text-xs text-muted-foreground self-center">
                  Total: {measurements.reduce((sum, m) => sum + m.sqft, 0).toLocaleString()} sq ft
                </span>
              </div>
            )}
            {!propertyAddress && (
              <p className="text-xs text-muted-foreground">
                Enter a property address above to enable yard measurement.
              </p>
            )}
            {propertyAddress && !addressCoords && (
              <p className="text-xs text-muted-foreground">
                Select an address from the suggestions to enable yard measurement.
              </p>
            )}
            {showMeasureTool && addressCoords && (
              <div className="mt-2 border rounded-lg p-3 bg-muted/30">
                <YardMeasureTool
                  lat={addressCoords.lat}
                  lng={addressCoords.lng}
                  existingPolygon={null}
                  existingArea={null}
                  onSave={handleMeasurementSave}
                  onCancel={() => setShowMeasureTool(false)}
                />
              </div>
            )}
            {generatingImage && (
              <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating measurement image...
              </div>
            )}
            {quoteImages.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                {quoteImages.map((img, idx) => (
                  <div key={idx} className="relative group border rounded-lg overflow-hidden">
                    <img
                      src={img.url.startsWith("/objects") ? img.url : `/objects/${img.url}`}
                      alt={img.caption}
                      className="w-full h-32 object-cover"
                      data-testid={`img-yard-${idx}`}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1.5 truncate">
                      {img.caption}
                    </div>
                    <button
                      data-testid={`button-remove-image-${idx}`}
                      type="button"
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeImage(idx)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Client-Facing Notes</Label>
              <Textarea
                data-testid="input-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes visible to the client..."
                rows={3}
              />
            </div>
            <div>
              <Label>Internal Notes</Label>
              <Textarea
                data-testid="input-internal-notes"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal notes (not visible to client)..."
                rows={3}
              />
            </div>
          </div>

          {!isEdit && (
            <div className="flex items-center gap-2 border-t pt-3">
              <Switch
                id="quote-suppress-notifications"
                checked={suppressNotifications}
                onCheckedChange={setSuppressNotifications}
                data-testid="switch-suppress-notifications"
              />
              <Label
                htmlFor="quote-suppress-notifications"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Suppress notifications
              </Label>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              data-testid="button-save-quote"
              onClick={handleSubmit}
              disabled={
                (quoteType === "commercial" &&
                  !livePricing &&
                  !(manualOverride && overrideEssential && overridePremium && overrideDeluxe)) ||
                !contactName ||
                createMutation.isPending
              }
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? "Update Quote" : "Create Quote"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
