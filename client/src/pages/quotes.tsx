import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Quote, Contact, Property } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Send, Eye, Trash2, Pencil, ClipboardCheck, Search,
  DollarSign, Home, Building2, Dog, Loader2, CheckCircle2, XCircle,
  Clock, FileText, MapPin, Camera, X, Ruler,
} from "lucide-react";
import { YardMeasureTool } from "@/components/yard-measure-tool";
import { AddressAutocomplete } from "@/components/address-autocomplete";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
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

function TierPreviewCards({ pricing, selectedTier, onSelectTier }: {
  pricing: TierPricing;
  selectedTier?: string;
  onSelectTier?: (tier: string) => void;
}) {
  const tiers = [
    { key: "essential", name: "Essential", price: pricing.essential, features: pricing.essentialFeatures, color: "border-slate-300", bg: "bg-slate-50" },
    { key: "premium", name: "Property Care", price: pricing.premium, features: pricing.premiumFeatures, color: "border-green-500", bg: "bg-green-50", recommended: true },
    { key: "deluxe", name: "Deluxe", price: pricing.deluxe, features: pricing.deluxeFeatures, color: "border-violet-500", bg: "bg-violet-50" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {tiers.map((tier) => (
        <div
          key={tier.key}
          data-testid={`tier-card-${tier.key}`}
          className={`relative border-2 rounded-lg p-4 cursor-pointer transition-all ${
            selectedTier === tier.key ? `${tier.color} ${tier.bg} ring-2 ring-offset-1` : "border-gray-200 hover:border-gray-300"
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
            <p className="text-2xl font-bold">${tier.price.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/visit</span></p>
          </div>
          <ul className="space-y-1">
            {tier.features.slice(0, 4).map((f, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
            {tier.features.length > 4 && (
              <li className="text-xs text-muted-foreground pl-4">+{tier.features.length - 4} more</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Quotes() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendQuoteId, setSendQuoteId] = useState<string | null>(null);
  const [sendVia, setSendVia] = useState("email");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);

  const { data: allQuotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["/api/quotes"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const filteredQuotes = useMemo(() => {
    let result = allQuotes;
    if (statusFilter !== "all") result = result.filter(q => q.status === statusFilter);
    if (typeFilter !== "all") result = result.filter(q => q.type === typeFilter);
    if (contactFilter !== "all") result = result.filter(q => q.contactId === contactFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(q =>
        q.contactName?.toLowerCase().includes(s) ||
        q.quoteNumber?.toLowerCase().includes(s) ||
        q.contactEmail?.toLowerCase().includes(s) ||
        q.propertyAddress?.toLowerCase().includes(s)
      );
    }
    return result;
  }, [allQuotes, statusFilter, typeFilter, contactFilter, searchTerm]);

  const stats = useMemo(() => ({
    total: allQuotes.length,
    draft: allQuotes.filter(q => q.status === "draft").length,
    sent: allQuotes.filter(q => q.status === "sent").length,
    accepted: allQuotes.filter(q => q.status === "accepted").length,
    totalValue: allQuotes
      .filter(q => q.status === "accepted")
      .reduce((sum, q) => sum + parseFloat(q.selectedPrice || q.premiumPrice || "0"), 0),
  }), [allQuotes]);

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Quotes & Proposals</h1>
          <p className="text-muted-foreground text-sm">Create and manage service quotes for residential and commercial clients</p>
        </div>
        <Button data-testid="button-create-quote" onClick={() => { setEditingQuote(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New Quote
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</p>
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
                <p className="text-2xl font-bold" data-testid="text-stat-pending">{stats.sent}</p>
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
                <p className="text-2xl font-bold" data-testid="text-stat-accepted">{stats.accepted}</p>
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
                <p className="text-2xl font-bold" data-testid="text-stat-value">${stats.totalValue.toFixed(0)}</p>
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
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            <TabsTrigger value="draft" data-testid="tab-draft">Draft</TabsTrigger>
            <TabsTrigger value="sent" data-testid="tab-sent">Sent</TabsTrigger>
            <TabsTrigger value="accepted" data-testid="tab-accepted">Accepted</TabsTrigger>
            <TabsTrigger value="declined" data-testid="tab-declined">Declined</TabsTrigger>
            <TabsTrigger value="expired" data-testid="tab-expired">Expired</TabsTrigger>
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
            {contacts.map(c => (
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
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="p-12 text-center">
              <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No quotes found</p>
              <Button variant="outline" className="mt-3" onClick={() => { setEditingQuote(null); setDialogOpen(true); }}>
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
                      <TableCell className="font-mono text-sm" data-testid={`text-quote-number-${quote.id}`}>{quote.quoteNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{quote.contactName || "—"}</p>
                          {quote.contactEmail && <p className="text-xs text-muted-foreground">{quote.contactEmail}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {quote.type === "residential" ? <Home className="h-3 w-3 mr-1" /> : <Building2 className="h-3 w-3 mr-1" />}
                          {quote.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{frequencyLabels[quote.frequency || ""] || quote.frequency || "—"}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {quote.selectedPrice ? (
                            <span className="font-semibold text-green-700">${parseFloat(quote.selectedPrice).toFixed(2)}/visit</span>
                          ) : (
                            <span>${parseFloat(quote.essentialPrice || "0").toFixed(0)}–${parseFloat(quote.deluxePrice || "0").toFixed(0)}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} data-testid={`badge-status-${quote.id}`}>{cfg.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {quote.createdAt ? new Date(quote.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" data-testid={`button-preview-${quote.id}`}
                            onClick={() => { setPreviewQuoteId(quote.id); setPreviewOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {(quote.status === "draft" || quote.status === "sent") && (
                            <>
                              <Button variant="ghost" size="icon" data-testid={`button-edit-${quote.id}`}
                                onClick={() => { setEditingQuote(quote); setDialogOpen(true); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" data-testid={`button-send-${quote.id}`}
                                onClick={() => { setSendQuoteId(quote.id); setSendDialogOpen(true); }}>
                                <Send className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {quote.status === "draft" && (
                            <Button variant="ghost" size="icon" data-testid={`button-delete-${quote.id}`}
                              onClick={() => { if (confirm("Delete this quote?")) deleteMutation.mutate(quote.id); }}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
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
        onOpenChange={setDialogOpen}
        quote={editingQuote}
        contacts={contacts}
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
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Quote
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Quote Preview</DialogTitle>
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

function CreateEditQuoteDialog({ open, onOpenChange, quote, contacts }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote | null;
  contacts: Contact[];
}) {
  const { toast } = useToast();
  const isEdit = !!quote;

  const [quoteType, setQuoteType] = useState<"residential" | "commercial">(
    quote?.type || "residential"
  );
  const [contactId, setContactId] = useState(quote?.contactId || "");
  const [propertyId, setPropertyId] = useState(quote?.propertyId || "");
  const [contactName, setContactName] = useState(quote?.contactName || "");
  const [contactEmail, setContactEmail] = useState(quote?.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(quote?.contactPhone || "");
  const [propertyAddress, setPropertyAddress] = useState(quote?.propertyAddress || "");
  const [expiresAt, setExpiresAt] = useState(quote?.expiresAt ? new Date(quote.expiresAt).toISOString().split("T")[0] : "");
  const [dogCount, setDogCount] = useState(quote?.dogCount || 2);
  const [yardSize, setYardSize] = useState(quote?.yardSize || "small");
  const [stationCount, setStationCount] = useState(quote?.stationCount || 4);
  const [commonAreaMinutes, setCommonAreaMinutes] = useState(quote?.commonAreaMinutes || 30);
  const [frequency, setFrequency] = useState(quote?.frequency || (quoteType === "residential" ? "weekly" : "1x_weekly"));
  const [isFirstTime, setIsFirstTime] = useState(quote?.isFirstTime !== false);
  const [notes, setNotes] = useState(quote?.notes || "");
  const [internalNotes, setInternalNotes] = useState(quote?.internalNotes || "");
  const [livePricing, setLivePricing] = useState<TierPricing | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [overrideEssential, setOverrideEssential] = useState("");
  const [overridePremium, setOverridePremium] = useState("");
  const [overrideDeluxe, setOverrideDeluxe] = useState("");
  const [quoteImages, setQuoteImages] = useState<{ url: string; caption: string; sqft?: number | null }[]>(
    (quote?.images as { url: string; caption: string; sqft?: number | null }[]) || []
  );
  const [generatingImage, setGeneratingImage] = useState(false);
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [measurePolygon, setMeasurePolygon] = useState<number[][] | null>(null);
  const [measureSqft, setMeasureSqft] = useState<number | null>(null);
  const [showMeasureTool, setShowMeasureTool] = useState(false);

  useEffect(() => {
    if (quote) {
      setQuoteType(quote.type || "residential");
      setContactId(quote.contactId || "");
      setPropertyId(quote.propertyId || "");
      setContactName(quote.contactName || "");
      setContactEmail(quote.contactEmail || "");
      setContactPhone(quote.contactPhone || "");
      setPropertyAddress(quote.propertyAddress || "");
      setExpiresAt(quote.expiresAt ? new Date(quote.expiresAt).toISOString().split("T")[0] : "");
      setDogCount(quote.dogCount || 2);
      setYardSize(quote.yardSize || "small");
      setStationCount(quote.stationCount || 4);
      setCommonAreaMinutes(quote.commonAreaMinutes || 30);
      setFrequency(quote.frequency || "weekly");
      setIsFirstTime(quote.isFirstTime !== false);
      setNotes(quote.notes || "");
      setInternalNotes(quote.internalNotes || "");
      setQuoteImages((quote.images as { url: string; caption: string; sqft?: number | null }[]) || []);
    } else {
      setQuoteType("residential");
      setContactId("");
      setPropertyId("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setPropertyAddress("");
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
      setMeasurePolygon(null);
      setMeasureSqft(null);
      setShowMeasureTool(false);
      setAddressCoords(null);
    }
  }, [quote, open]);

  const pricingParams = useMemo(() => {
    if (quoteType === "residential") {
      return `type=residential&dogCount=${dogCount}&yardSize=${yardSize}&frequency=${frequency}&isFirstTime=${isFirstTime}`;
    }
    return `type=commercial&stationCount=${stationCount}&commonAreaMinutes=${commonAreaMinutes}&frequency=${frequency}`;
  }, [quoteType, dogCount, yardSize, stationCount, commonAreaMinutes, frequency, isFirstTime]);

  const { data: calculatedPricing } = useQuery<TierPricing>({
    queryKey: ["/api/quotes/calculate-pricing", pricingParams],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/calculate-pricing?${pricingParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to calculate pricing");
      return res.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (calculatedPricing) setLivePricing(calculatedPricing);
  }, [calculatedPricing]);

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
    const contact = contacts.find(c => c.id === id);
    if (contact) {
      setContactName(`${contact.firstName} ${contact.lastName}`.trim());
      setContactEmail(contact.email || "");
      setContactPhone(contact.phone || "");
    }
  };

  const handlePropertySelect = (id: string) => {
    setPropertyId(id);
    const prop = contactProperties?.find(p => p.id === id);
    if (prop) {
      setPropertyAddress(prop.address || "");
    }
  };

  const selectedProperty = contactProperties?.find(p => p.id === propertyId);

  const handleAddressSelect = useCallback((parsed: { streetAddress: string; city: string; state: string; zipCode: string; latitude: string; longitude: string }) => {
    if (parsed.latitude && parsed.longitude) {
      setAddressCoords({ lat: parseFloat(parsed.latitude), lng: parseFloat(parsed.longitude) });
    } else {
      setAddressCoords(null);
    }
    setMeasurePolygon(null);
    setMeasureSqft(null);
    setShowMeasureTool(false);
  }, []);

  const handleGenerateYardImage = useCallback(async (polygon: number[][], sqft: number, lat: number, lng: number) => {
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
      setQuoteImages(prev => [...prev, { url: data.url, caption: data.caption, sqft: data.sqft }]);
      toast({ title: "Measurement saved & image captured" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate image";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setGeneratingImage(false);
    }
  }, [generatingImage, toast]);

  const handleMeasurementSave = useCallback((polygon: number[][], areaSqft: number) => {
    setMeasurePolygon(polygon);
    setMeasureSqft(areaSqft);
    setShowMeasureTool(false);
    if (addressCoords) {
      handleGenerateYardImage(polygon, areaSqft, addressCoords.lat, addressCoords.lng);
    }
  }, [addressCoords, handleGenerateYardImage]);

  const removeImage = (idx: number) => {
    setQuoteImages(prev => prev.filter((_, i) => i !== idx));
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      onOpenChange(false);
      toast({ title: isEdit ? "Quote updated" : "Quote created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const p = livePricing;
    if (!p) return;

    const data: Record<string, unknown> = {
      type: quoteType,
      contactId: contactId || null,
      propertyId: propertyId || null,
      contactName,
      contactEmail,
      contactPhone,
      propertyAddress,
      frequency,
      notes: notes || null,
      internalNotes: internalNotes || null,
      isFirstTime,
      essentialPrice: manualOverride && overrideEssential ? overrideEssential : p.essential.toFixed(2),
      premiumPrice: manualOverride && overridePremium ? overridePremium : p.premium.toFixed(2),
      deluxePrice: manualOverride && overrideDeluxe ? overrideDeluxe : p.deluxe.toFixed(2),
      initialCleanFee: p.initialCleanFee.toFixed(2),
      essentialFeatures: p.essentialFeatures,
      premiumFeatures: p.premiumFeatures,
      deluxeFeatures: p.deluxeFeatures,
      pricingBreakdown: p.breakdown,
      images: quoteImages.length > 0 ? quoteImages : null,
      expiresAt: expiresAt || null,
    };

    if (quoteType === "residential") {
      data.dogCount = dogCount;
      data.yardSize = yardSize;
    } else {
      data.stationCount = stationCount;
      data.commonAreaMinutes = commonAreaMinutes;
    }

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
          <DialogTitle data-testid="text-dialog-title">{isEdit ? "Edit Quote" : "New Quote"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the quote details below." : "Fill in the details to generate a service quote with tiered pricing."}
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
                    quoteType === "residential" ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => { setQuoteType("residential"); setFrequency("weekly"); }}
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
                    quoteType === "commercial" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => { setQuoteType("commercial"); setFrequency("1x_weekly"); }}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={handleContactSelect}>
                <SelectTrigger data-testid="select-contact">
                  <SelectValue placeholder="Select existing contact..." />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input data-testid="input-contact-name" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <Label>Email</Label>
              <Input data-testid="input-email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input data-testid="input-phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(555) 123-4567" />
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
                    {contactProperties.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={contactId && contactProperties && contactProperties.length > 0 ? "" : "md:col-span-2"}>
              <Label>Property Address</Label>
              <AddressAutocomplete
                data-testid="input-address"
                value={propertyAddress}
                onChange={setPropertyAddress}
                onSelect={handleAddressSelect}
                placeholder="Start typing an address..."
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Expiration Date</Label>
              <Input data-testid="input-expires-at" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Leave blank for 30-day default when sent</p>
            </div>
          </div>

          {quoteType === "residential" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label>Number of Dogs</Label>
                <Input data-testid="input-dog-count" type="number" min={1} max={20} value={dogCount} onChange={e => setDogCount(parseInt(e.target.value) || 1)} />
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
                    {resFrequencies.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch data-testid="switch-first-time" checked={isFirstTime} onCheckedChange={setIsFirstTime} />
                <Label className="text-sm">First-time clean</Label>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label>Waste Stations</Label>
                <Input data-testid="input-station-count" type="number" min={1} max={100} value={stationCount} onChange={e => setStationCount(parseInt(e.target.value) || 1)} />
              </div>
              <div>
                <Label>Common Area (minutes)</Label>
                <Input data-testid="input-common-area" type="number" min={0} max={480} value={commonAreaMinutes} onChange={e => setCommonAreaMinutes(parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger data-testid="select-frequency-commercial">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {comFrequencies.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {livePricing && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Tier Pricing Preview</h3>
                <div className="flex items-center gap-2">
                  <Switch data-testid="switch-manual-override" checked={manualOverride} onCheckedChange={setManualOverride} />
                  <Label className="text-xs">Manual price override</Label>
                </div>
              </div>

              {manualOverride ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs">Essential Price</Label>
                    <Input
                      data-testid="input-override-essential"
                      type="number"
                      step="0.01"
                      value={overrideEssential || livePricing.essential.toFixed(2)}
                      onChange={e => setOverrideEssential(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Property Care Price</Label>
                    <Input
                      data-testid="input-override-premium"
                      type="number"
                      step="0.01"
                      value={overridePremium || livePricing.premium.toFixed(2)}
                      onChange={e => setOverridePremium(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Deluxe Price</Label>
                    <Input
                      data-testid="input-override-deluxe"
                      type="number"
                      step="0.01"
                      value={overrideDeluxe || livePricing.deluxe.toFixed(2)}
                      onChange={e => setOverrideDeluxe(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <TierPreviewCards pricing={livePricing} />
              )}

              {livePricing.initialCleanFee > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800">
                    <strong>Initial Clean Fee:</strong> ${livePricing.initialCleanFee.toFixed(2)} (one-time)
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Yard Measurement</Label>
              {addressCoords && !showMeasureTool && (
                <Button
                  data-testid="button-open-measure-tool"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMeasureTool(true)}
                >
                  <Ruler className="h-3 w-3 mr-1" />
                  {measurePolygon ? "Re-measure" : "Measure Yard"}
                </Button>
              )}
            </div>
            {!propertyAddress && (
              <p className="text-xs text-muted-foreground">Enter a property address above to enable yard measurement.</p>
            )}
            {propertyAddress && !addressCoords && (
              <p className="text-xs text-muted-foreground">Select an address from the suggestions to enable yard measurement.</p>
            )}
            {showMeasureTool && addressCoords && (
              <div className="mt-2 border rounded-lg p-3 bg-muted/30">
                <YardMeasureTool
                  lat={addressCoords.lat}
                  lng={addressCoords.lng}
                  existingPolygon={measurePolygon}
                  existingArea={measureSqft}
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
              <Textarea data-testid="input-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes visible to the client..." rows={3} />
            </div>
            <div>
              <Label>Internal Notes</Label>
              <Textarea data-testid="input-internal-notes" value={internalNotes} onChange={e => setInternalNotes(e.target.value)} placeholder="Internal notes (not visible to client)..." rows={3} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">Cancel</Button>
            <Button
              data-testid="button-save-quote"
              onClick={handleSubmit}
              disabled={!livePricing || !contactName || createMutation.isPending}
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
