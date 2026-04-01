import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import type { ServicePlan, Contact, Property } from "@shared/schema";

type ServicePricingItem = {
  id: string;
  name: string;
  category: string;
  basePrice: string;
  unit: string;
  isActive: boolean;
};
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Briefcase, Plus, Search, CheckCircle, Clock, Loader2,
  Edit2, Trash2, Eye, ChevronDown, ChevronUp, Filter,
  User, Calendar,
} from "lucide-react";
import { Link } from "wouter";

type TeamMember = {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
};

type EnrichedJob = ServicePlan & {
  contact?: Contact;
  property?: Property;
};

const jobStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const jobStatusLabels: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const frequencyLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  onetime: "One-Time",
};

const dayLabels: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

interface JobFormPayload {
  contactId: string;
  propertyId: string;
  serviceName: string | null;
  jobType: string;
  frequency: string;
  dayOfWeek: string | null;
  pricePerVisit: string;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  anytime: boolean;
  visitInstructions: string | null;
  assignedUserId: string | null;
  endsAfterCount?: number | null;
  endsAfterUnit?: string | null;
  endDate?: string | null;
}

function JobForm({
  onSubmit,
  isPending,
  contacts,
  properties,
  team,
  services,
  initial,
  submitLabel,
}: {
  onSubmit: (data: JobFormPayload) => void;
  isPending: boolean;
  contacts: Contact[];
  properties: Property[];
  team: TeamMember[];
  services: ServicePricingItem[];
  initial?: Partial<ServicePlan>;
  submitLabel: string;
}) {
  const tz = useCompanyTimezone();
  const [jobType, setJobType] = useState<string>(initial?.jobType || "one_off");
  const [contactId, setContactId] = useState(initial?.contactId || "");
  const [propertyId, setPropertyId] = useState(initial?.propertyId || "");
  const [selectedServices, setSelectedServices] = useState<Array<{ id: string; name: string; price: string }>>(() => {
    if (initial?.serviceName) {
      return initial.serviceName.split(" + ").map((name, i) => ({ id: `initial-${i}`, name: name.trim(), price: "" }));
    }
    return [];
  });
  const [addServiceId, setAddServiceId] = useState("");
  const [frequency, setFrequency] = useState(initial?.frequency || "weekly");
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek || "");
  const [pricePerVisit, setPricePerVisit] = useState(initial?.pricePerVisit || "");
  const [startDate, setStartDate] = useState(initial?.startDate || toLocalDateString(new Date(), tz));
  const [startTime, setStartTime] = useState(initial?.startTime || "");
  const [endTime, setEndTime] = useState(initial?.endTime || "");
  const [anytime, setAnytime] = useState(initial?.anytime !== false);
  const [endsAfterMode, setEndsAfterMode] = useState<"none" | "count" | "date">(
    initial?.endsAfterCount ? "count" : initial?.endDate ? "date" : "none"
  );
  const [endsAfterCount, setEndsAfterCount] = useState(initial?.endsAfterCount?.toString() || "");
  const [endsAfterUnit, setEndsAfterUnit] = useState(initial?.endsAfterUnit || "months");
  const [endDate, setEndDate] = useState(initial?.endDate || "");
  const [visitInstructions, setVisitInstructions] = useState(initial?.visitInstructions || "");
  const [assignedUserId, setAssignedUserId] = useState(initial?.assignedUserId || "");

  const activeServices = useMemo(() => services.filter(s => s.isActive), [services]);

  const filteredProperties = useMemo(() => {
    if (!contactId) return [];
    return properties.filter(p => p.contactId === contactId);
  }, [contactId, properties]);

  const totalPrice = useMemo(() => {
    if (selectedServices.length === 0) return pricePerVisit;
    const sum = selectedServices.reduce((acc, s) => acc + parseFloat(s.price || "0"), 0);
    return sum > 0 ? sum.toFixed(2) : pricePerVisit;
  }, [selectedServices, pricePerVisit]);

  const combinedServiceName = useMemo(() => {
    if (selectedServices.length === 0) return null;
    return selectedServices.map(s => s.name).join(" + ");
  }, [selectedServices]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: JobFormPayload = {
      contactId,
      propertyId,
      serviceName: combinedServiceName,
      jobType,
      frequency: jobType === "one_off" ? "onetime" : frequency,
      dayOfWeek: dayOfWeek || null,
      pricePerVisit: totalPrice || "0",
      startDate,
      startTime: anytime ? null : (startTime || null),
      endTime: anytime ? null : (endTime || null),
      anytime,
      visitInstructions: visitInstructions || null,
      assignedUserId: (assignedUserId && assignedUserId !== "none") ? assignedUserId : null,
    };

    if (jobType === "recurring") {
      if (endsAfterMode === "count" && endsAfterCount) {
        payload.endsAfterCount = parseInt(endsAfterCount);
        payload.endsAfterUnit = endsAfterUnit;
        payload.endDate = null;
      } else if (endsAfterMode === "date" && endDate) {
        payload.endDate = endDate;
        payload.endsAfterCount = null;
        payload.endsAfterUnit = null;
      } else {
        payload.endsAfterCount = null;
        payload.endsAfterUnit = null;
        payload.endDate = null;
      }
    } else {
      payload.endsAfterCount = null;
      payload.endsAfterUnit = null;
      payload.endDate = null;
    }

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Job Type</Label>
        <div className="flex gap-2 mt-1.5">
          <Button
            type="button"
            variant={jobType === "one_off" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setJobType("one_off");
              setFrequency("onetime");
            }}
            data-testid="button-job-type-one-off"
          >
            One-off
          </Button>
          <Button
            type="button"
            variant={jobType === "recurring" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setJobType("recurring");
              setFrequency("weekly");
            }}
            data-testid="button-job-type-recurring"
          >
            Recurring
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="job-contact">Customer</Label>
          <Select value={contactId} onValueChange={(v) => { setContactId(v); setPropertyId(""); }}>
            <SelectTrigger data-testid="select-job-contact">
              <SelectValue placeholder="Select customer" />
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

        <div className="space-y-1.5">
          <Label htmlFor="job-property">Property</Label>
          <Select value={propertyId} onValueChange={setPropertyId} disabled={!contactId}>
            <SelectTrigger data-testid="select-job-property">
              <SelectValue placeholder={contactId ? "Select property" : "Select customer first"} />
            </SelectTrigger>
            <SelectContent>
              {filteredProperties.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.streetAddress}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Services</Label>
        {selectedServices.length > 0 && (
          <div className="space-y-2">
            {selectedServices.map((svc, idx) => (
              <div key={svc.id + idx} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2" data-testid={`service-row-${idx}`}>
                <span className="text-sm font-medium">{svc.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">${parseFloat(svc.price || "0").toFixed(2)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setSelectedServices(prev => prev.filter((_, i) => i !== idx))}
                    data-testid={`button-remove-service-${idx}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeServices.length > 0 ? (
          <div className="flex gap-2">
            <Select value={addServiceId} onValueChange={setAddServiceId}>
              <SelectTrigger className="flex-1" data-testid="select-job-service">
                <SelectValue placeholder="Add a service..." />
              </SelectTrigger>
              <SelectContent>
                {activeServices.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — ${parseFloat(s.basePrice).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!addServiceId}
              onClick={() => {
                const svc = activeServices.find(s => s.id === addServiceId);
                if (svc) {
                  setSelectedServices(prev => [...prev, { id: svc.id, name: svc.name, price: svc.basePrice }]);
                  setAddServiceId("");
                }
              }}
              data-testid="button-add-service"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Input
            value={pricePerVisit}
            onChange={e => setPricePerVisit(e.target.value)}
            placeholder="Service name"
            data-testid="input-job-service-name"
          />
        )}
        <div className="flex items-center justify-between pt-1">
          <Label htmlFor="job-price" className="text-sm">Total per Visit</Label>
          <span className="text-sm font-semibold" data-testid="text-total-price">${parseFloat(totalPrice || "0").toFixed(2)}</span>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3">Schedule</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              data-testid="input-job-start-date"
            />
          </div>

          {!anytime && (
            <>
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  data-testid="input-job-start-time"
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  data-testid="input-job-end-time"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Checkbox
            id="anytime"
            checked={anytime}
            onCheckedChange={(checked) => setAnytime(!!checked)}
            data-testid="checkbox-job-anytime"
          />
          <Label htmlFor="anytime" className="text-sm cursor-pointer">Anytime</Label>
        </div>
      </div>

      {jobType === "recurring" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Repeats</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger data-testid="select-job-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {frequency !== "monthly" && (
              <div className="space-y-1.5">
                <Label>Day of Week</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger data-testid="select-job-day">
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(dayLabels).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold">End Condition</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="endsAfterMode"
                  checked={endsAfterMode === "none"}
                  onChange={() => setEndsAfterMode("none")}
                  className="accent-primary"
                  data-testid="radio-ends-never"
                />
                <span className="text-sm">No end date</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="endsAfterMode"
                  checked={endsAfterMode === "count"}
                  onChange={() => setEndsAfterMode("count")}
                  className="accent-primary"
                  data-testid="radio-ends-after"
                />
                <span className="text-sm">Ends after</span>
              </label>
              {endsAfterMode === "count" && (
                <div className="flex gap-2 ml-6">
                  <Input
                    type="number"
                    min="1"
                    value={endsAfterCount}
                    onChange={e => setEndsAfterCount(e.target.value)}
                    className="w-20"
                    data-testid="input-ends-after-count"
                  />
                  <Select value={endsAfterUnit} onValueChange={setEndsAfterUnit}>
                    <SelectTrigger className="w-32" data-testid="select-ends-after-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="weeks">Weeks</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                      <SelectItem value="years">Years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="endsAfterMode"
                  checked={endsAfterMode === "date"}
                  onChange={() => setEndsAfterMode("date")}
                  className="accent-primary"
                  data-testid="radio-ends-on"
                />
                <span className="text-sm">Ends on</span>
              </label>
              {endsAfterMode === "date" && (
                <div className="ml-6">
                  <Input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    data-testid="input-ends-on-date"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {jobType === "one_off" && (
        <div className="space-y-1.5">
          <Label className="text-sm text-muted-foreground">Repeats</Label>
          <p className="text-sm">Does not repeat</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Assigned Team Member</Label>
        <Select value={assignedUserId} onValueChange={setAssignedUserId}>
          <SelectTrigger data-testid="select-job-assigned">
            <SelectValue placeholder="Select team member (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {team.map(t => (
              <SelectItem key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Visit Instructions</Label>
        <Textarea
          value={visitInstructions}
          onChange={e => setVisitInstructions(e.target.value)}
          placeholder="Instructions for technician..."
          rows={3}
          data-testid="input-job-instructions"
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending || !contactId || !propertyId || (activeServices.length > 0 && selectedServices.length === 0)} data-testid="button-submit-job">
          {isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...</> : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function Jobs() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editJob, setEditJob] = useState<ServicePlan | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: jobs, isLoading } = useQuery<ServicePlan[]>({
    queryKey: ["/api/jobs"],
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: team } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
  });

  const { data: services } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: JobFormPayload) => {
      await apiRequest("POST", "/api/jobs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits") });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      setCreateOpen(false);
      toast({ title: "Job created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: JobFormPayload }) => {
      await apiRequest("PATCH", `/api/service-plans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits") });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      setEditJob(null);
      toast({ title: "Job updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/service-plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits") });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      setDeleteId(null);
      toast({ title: "Job deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/jobs/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits") });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      toast({ title: "Job approved and activated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const enrichedJobs = useMemo<EnrichedJob[]>(() => {
    if (!jobs) return [];
    return jobs.map(job => ({
      ...job,
      contact: contacts?.find(c => c.id === job.contactId),
      property: properties?.find(p => p.id === job.propertyId),
    }));
  }, [jobs, contacts, properties]);

  const filteredJobs = useMemo(() => {
    let result = enrichedJobs;
    if (statusFilter !== "all") {
      result = result.filter(j => j.jobStatus === statusFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter(j => j.jobType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(j => {
        const contactName = j.contact ? `${j.contact.firstName} ${j.contact.lastName}`.toLowerCase() : "";
        const address = j.property?.streetAddress?.toLowerCase() || "";
        const name = j.serviceName?.toLowerCase() || "";
        return contactName.includes(q) || address.includes(q) || name.includes(q);
      });
    }
    return result;
  }, [enrichedJobs, statusFilter, typeFilter, search]);

  const counts = useMemo(() => {
    if (!jobs) return { draft: 0, approved: 0, active: 0, completed: 0, cancelled: 0, total: 0 };
    return {
      draft: jobs.filter(j => j.jobStatus === "draft").length,
      approved: jobs.filter(j => j.jobStatus === "approved").length,
      active: jobs.filter(j => j.jobStatus === "active").length,
      completed: jobs.filter(j => j.jobStatus === "completed").length,
      cancelled: jobs.filter(j => j.jobStatus === "cancelled").length,
      total: jobs.length,
    };
  }, [jobs]);

  const getAssignedName = (userId: string | null) => {
    if (!userId || !team) return null;
    const member = team.find(t => t.id === userId);
    return member ? `${member.firstName} ${member.lastName}` : null;
  };

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-jobs-heading">
            <Briefcase className="h-6 w-6" />
            Jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage one-off and recurring jobs for your customers
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-job">
          <Plus className="h-4 w-4 mr-1" /> New Job
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="cursor-pointer" onClick={() => setStatusFilter("all")} data-testid="card-stat-total">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.total}</p>
            <p className="text-xs text-muted-foreground">Total Jobs</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("draft")} data-testid="card-stat-draft">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.draft}</p>
            <p className="text-xs text-muted-foreground">Drafts</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("approved")} data-testid="card-stat-approved">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.approved}</p>
            <p className="text-xs text-muted-foreground">Approved</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("active")} data-testid="card-stat-active">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.active}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("completed")} data-testid="card-stat-completed">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{counts.completed}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-jobs-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="one_off">One-off</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filteredJobs.length > 0 ? (
        <div className="space-y-3">
          {filteredJobs.map(job => {
            const isExpanded = expandedId === job.id;
            const assignedName = getAssignedName(job.assignedUserId);
            return (
              <Card key={job.id} data-testid={`card-job-${job.id}`}>
                <CardContent className="p-4">
                  <div
                    className="flex items-start justify-between gap-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : job.id)}
                    data-testid={`button-expand-job-${job.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" data-testid={`text-job-contact-${job.id}`}>
                          {job.contact ? `${job.contact.firstName} ${job.contact.lastName}` : "Unknown"}
                        </p>
                        {job.serviceName && (
                          <span className="text-xs text-muted-foreground">- {job.serviceName}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-job-address-${job.id}`}>
                        {job.property?.streetAddress || "No address"}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className={`text-xs ${jobStatusColors[job.jobStatus || "active"]}`} data-testid={`badge-job-status-${job.id}`}>
                          {jobStatusLabels[job.jobStatus || "active"]}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize" data-testid={`badge-job-type-${job.id}`}>
                          {job.jobType === "one_off" ? "One-off" : "Recurring"}
                        </Badge>
                        {job.jobType === "recurring" && (
                          <span className="text-xs text-muted-foreground">
                            {frequencyLabels[job.frequency] || job.frequency}
                            {job.dayOfWeek ? ` on ${dayLabels[job.dayOfWeek] || job.dayOfWeek}` : ""}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">${Number(job.pricePerVisit).toFixed(2)}/visit</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-muted-foreground">
                        {assignedName && (
                          <span data-testid={`text-job-assigned-${job.id}`}>
                            <User className="h-3 w-3 inline mr-0.5" />{assignedName}
                          </span>
                        )}
                        <span data-testid={`text-job-next-visit-${job.id}`}>
                          <Calendar className="h-3 w-3 inline mr-0.5" />
                          {job.startDate ? `Starts ${job.startDate}` : "No date set"}
                        </span>
                        <span data-testid={`text-job-schedule-${job.id}`}>
                          {job.jobType === "one_off"
                            ? "One-time visit"
                            : `${frequencyLabels[job.frequency] || job.frequency}${job.dayOfWeek ? `, ${dayLabels[job.dayOfWeek] || job.dayOfWeek}s` : ""}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Start Date</p>
                          <p>{job.startDate}</p>
                        </div>
                        {job.endDate && (
                          <div>
                            <p className="text-xs text-muted-foreground">End Date</p>
                            <p>{job.endDate}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">Time Window</p>
                          <p>{job.anytime ? "Anytime" : `${job.startTime || "--"} - ${job.endTime || "--"}`}</p>
                        </div>
                        {assignedName && (
                          <div>
                            <p className="text-xs text-muted-foreground">Assigned To</p>
                            <p>{assignedName}</p>
                          </div>
                        )}
                        {job.endsAfterCount && job.endsAfterUnit && (
                          <div>
                            <p className="text-xs text-muted-foreground">Ends After</p>
                            <p>{job.endsAfterCount} {job.endsAfterUnit}</p>
                          </div>
                        )}
                      </div>

                      {job.visitInstructions && (
                        <div>
                          <p className="text-xs text-muted-foreground">Visit Instructions</p>
                          <p className="text-sm">{job.visitInstructions}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        {job.jobStatus === "draft" && (
                          <Button
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); approveMutation.mutate(job.id); }}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-job-${job.id}`}
                          >
                            {approveMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            )}
                            Approve & Activate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setEditJob(job); }}
                          data-testid={`button-edit-job-${job.id}`}
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Link href={`/contacts/${job.contactId}`}>
                          <Button size="sm" variant="outline" data-testid={`button-view-contact-${job.id}`}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> View Customer
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteId(job.servicePlanId || job.id); }}
                          data-testid={`button-delete-job-${job.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-jobs">
            {search || statusFilter !== "all" || typeFilter !== "all"
              ? "No jobs match your filters."
              : "No jobs yet. Create your first job to get started."}
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Job</DialogTitle>
          </DialogHeader>
          {contacts && properties && team && (
            <JobForm
              onSubmit={data => createMutation.mutate(data)}
              isPending={createMutation.isPending}
              contacts={contacts}
              properties={properties}
              team={team}
              services={services || []}
              submitLabel="Create Job"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editJob} onOpenChange={open => { if (!open) setEditJob(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
          </DialogHeader>
          {editJob && contacts && properties && team && (
            <JobForm
              onSubmit={data => updateMutation.mutate({ id: ('servicePlanId' in editJob && editJob.servicePlanId) ? editJob.servicePlanId : editJob.id, data })}
              isPending={updateMutation.isPending}
              contacts={contacts}
              properties={properties}
              team={team}
              services={services || []}
              initial={editJob}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this job and all associated visits. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete-job"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
