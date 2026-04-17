import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  Calendar,
  Activity,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  MapPin,
  Users,
  Navigation,
  ChevronDown,
  ChevronRight,
  List,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarUI } from "@/components/ui/calendar";

interface CommandCenterVisit {
  id: string;
  status: string;
  scheduledDate: string;
  scheduledTime?: string | null;
  routeName?: string | null;
  routeColor?: string | null;
  servicePlanName?: string | null;
  pricePerVisit: string;
  techName?: string | null;
  property?: {
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  contact?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

interface CommandCenterStats {
  visits: CommandCenterVisit[];
  stats: {
    totalToday: number;
    inProgress: number;
    completed: number;
    upcoming: number;
  };
  billing: {
    expectedRevenue: number;
    completedRevenue: number;
    pendingRevenue: number;
    invoicesCreatedToday: number;
    totalInvoiced: number;
    totalPaid: number;
  };
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function formatTime(time?: string | null) {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    scheduled:   { label: "Scheduled",   className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    in_progress: { label: "In Progress", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    completed:   { label: "Completed",   className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    skipped:     { label: "Skipped",     className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    cancelled:   { label: "Cancelled",   className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };
  const s = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {status === "in_progress" && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {s.label}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  loading?: boolean;
}) {
  return (
    <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`rounded-xl p-2.5 ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div>
          {loading ? (
            <Skeleton className="h-7 w-12 mb-1" />
          ) : (
            <div className="text-2xl font-bold">{value}</div>
          )}
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TechLegend({ visits }: { visits: CommandCenterVisit[] }) {
  const techCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of visits) {
      const name = v.techName ?? "Unassigned";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [visits]);

  if (techCounts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mt-3">
      {techCounts.map(([name, count]) => (
        <div key={name} className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{name}</span>
          <span>· {count} stop{count !== 1 ? "s" : ""}</span>
        </div>
      ))}
    </div>
  );
}

interface TechGroup {
  techName: string;
  visits: CommandCenterVisit[];
  totalRevenue: number;
}

function buildTechGroups(visits: CommandCenterVisit[]): TechGroup[] {
  const map = new Map<string, CommandCenterVisit[]>();
  visits.forEach(v => {
    const key = v.techName ?? "Unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  });
  const groups: TechGroup[] = [];
  Array.from(map.entries()).forEach(([techName, techVisits]) => {
    if (techName !== "Unassigned") {
      groups.push({
        techName,
        visits: techVisits,
        totalRevenue: techVisits.reduce((sum: number, v: CommandCenterVisit) => sum + parseFloat(v.pricePerVisit || "0"), 0),
      });
    }
  });
  groups.sort((a, b) => a.techName.localeCompare(b.techName));
  if (map.has("Unassigned")) {
    const uVisits = map.get("Unassigned")!;
    groups.push({
      techName: "Unassigned",
      visits: uVisits,
      totalRevenue: uVisits.reduce((sum: number, v: CommandCenterVisit) => sum + parseFloat(v.pricePerVisit || "0"), 0),
    });
  }
  return groups;
}

export default function CommandCenter() {
  const [, navigate] = useLocation();
  const todayDate = new Date();
  const todayString = toLocalDateString(todayDate);

  const [selectedDate, setSelectedDate] = useState<Date>(todayDate);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedDateString = toLocalDateString(selectedDate);
  const isToday = selectedDateString === todayString;
  const dateLabel = format(selectedDate, "EEEE, MMMM d");

  const { data, isLoading } = useQuery<CommandCenterStats>({
    queryKey: ["/api/admin/command-center-stats", selectedDateString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/command-center-stats?date=${selectedDateString}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: isToday ? 30000 : false,
  });

  // Map tab: auto-refresh tick every 60s (only for today)
  const [mapTick, setMapTick] = useState(0);
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setMapTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, [isToday]);

  // Reset map loaded state when date changes
  const [mapLoaded, setMapLoaded] = useState(false);
  const [groupByTech, setGroupByTech] = useState<boolean>(() => {
    try {
      return localStorage.getItem("commandCenter.groupByTech") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("commandCenter.groupByTech", String(groupByTech));
    } catch {
    }
  }, [groupByTech]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    setMapLoaded(false);
  }, [selectedDateString]);

  const visits = data?.visits ?? [];
  const stats = data?.stats;
  const billing = data?.billing;

  const techGroups = useMemo(() => buildTechGroups(visits), [visits]);

  function toggleGroup(techName: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(techName)) next.delete(techName);
      else next.add(techName);
      return next;
    });
  }

  const upcomingVisits = useMemo(
    () => visits.filter(v => v.status === "scheduled").slice(0, 3),
    [visits]
  );

  const googleMapsUrl = useMemo(() => {
    const addrs = visits
      .filter(v => v.property?.streetAddress)
      .map(v => [v.property!.streetAddress, v.property!.city, v.property!.state].filter(Boolean).join(", "));
    if (addrs.length === 0) return null;
    const dest = encodeURIComponent(addrs[addrs.length - 1]);
    const waypoints = addrs.slice(0, -1).map(encodeURIComponent).join("|");
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ""}`;
  }, [visits]);

  const mapSrc = `/api/admin/daily-map?date=${selectedDateString}&t=${mapTick}`;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-command-center">
            Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Company-wide view for {dateLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Picker */}
          <div className="flex items-center gap-2">
            {!isToday && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-sm"
                onClick={() => setSelectedDate(todayDate)}
                data-testid="button-today"
              >
                Today
              </Button>
            )}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2 text-sm font-normal min-w-[160px] justify-between"
                  data-testid="button-date-picker"
                >
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {format(selectedDate, "MMM d, yyyy")}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end" data-testid="popover-calendar">
                <CalendarUI
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => {
                    if (d) {
                      setSelectedDate(d);
                      setCalendarOpen(false);
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <Link href="/scheduling">
            <a
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline h-9 px-1"
              data-testid="link-open-schedule"
            >
              Open Schedule <ArrowRight className="h-4 w-4" />
            </a>
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Today"
          value={stats?.totalToday ?? 0}
          icon={Calendar}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          iconColor="text-blue-600 dark:text-blue-400"
          loading={isLoading}
        />
        <StatCard
          label="In Progress"
          value={stats?.inProgress ?? 0}
          icon={Activity}
          iconBg="bg-green-100 dark:bg-green-900/30"
          iconColor="text-green-600 dark:text-green-400"
          loading={isLoading}
        />
        <StatCard
          label="Completed"
          value={stats?.completed ?? 0}
          icon={CheckCircle2}
          iconBg="bg-gray-100 dark:bg-gray-800"
          iconColor="text-gray-500 dark:text-gray-400"
          loading={isLoading}
        />
        <StatCard
          label="Upcoming"
          value={stats?.upcoming ?? 0}
          icon={Clock}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          iconColor="text-amber-600 dark:text-amber-400"
          loading={isLoading}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList data-testid="tabs-command-center">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="map" data-testid="tab-map">Route Map</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left: Appointments Table */}
            <div className="flex-1 min-w-0">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      All Appointments
                      {!isLoading && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          {visits.length}
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex items-center rounded-md border overflow-hidden text-xs font-medium">
                      <button
                        className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${!groupByTech ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                        onClick={() => setGroupByTech(false)}
                        data-testid="toggle-flat-list"
                      >
                        <List className="h-3.5 w-3.5" />
                        Flat list
                      </button>
                      <button
                        className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${groupByTech ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                        onClick={() => setGroupByTech(true)}
                        data-testid="toggle-by-technician"
                      >
                        <Users className="h-3.5 w-3.5" />
                        By technician
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="space-y-3 p-4">
                      {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : visits.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      No appointments scheduled for {isToday ? "today" : format(selectedDate, "MMM d")}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20">Time</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead className="hidden md:table-cell">Service</TableHead>
                            {!groupByTech && (
                              <TableHead className="hidden md:table-cell">Technician</TableHead>
                            )}
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden sm:table-cell text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupByTech ? (
                            techGroups.map(group => {
                              const isCollapsed = collapsedGroups.has(group.techName);
                              return (
                                <>
                                  <TableRow
                                    key={`group-${group.techName}`}
                                    className="bg-muted/60 dark:bg-muted/30 hover:bg-muted/80 dark:hover:bg-muted/50 cursor-pointer select-none"
                                    onClick={() => toggleGroup(group.techName)}
                                    data-testid={`group-header-${group.techName.toLowerCase().replace(/\s+/g, "-")}`}
                                  >
                                    <TableCell colSpan={5} className="py-2.5 font-semibold text-sm">
                                      <div className="flex items-center gap-2">
                                        {isCollapsed
                                          ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                        }
                                        <span>{group.techName}</span>
                                        <span className="font-normal text-muted-foreground text-xs">
                                          · {group.visits.length} stop{group.visits.length !== 1 ? "s" : ""}
                                          {" · "}
                                          {formatCurrency(group.totalRevenue)}
                                        </span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  {!isCollapsed && group.visits.map(v => (
                                    <TableRow
                                      key={v.id}
                                      data-testid={`row-visit-${v.id}`}
                                      className={`cursor-pointer hover:bg-muted/50 transition-colors${v.status === "completed" ? " opacity-60" : ""}`}
                                      onClick={() => navigate(`/scheduling?date=${v.scheduledDate}&visitId=${v.id}`)}
                                    >
                                      <TableCell className="text-sm font-medium whitespace-nowrap">
                                        {formatTime(v.scheduledTime)}
                                      </TableCell>
                                      <TableCell>
                                        <div className="font-medium text-sm leading-tight">
                                          {v.contact
                                            ? `${v.contact.firstName ?? ""} ${v.contact.lastName ?? ""}`.trim() || "—"
                                            : "—"}
                                        </div>
                                        {v.property?.streetAddress && (
                                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                            {v.property.streetAddress}
                                            {v.property.city ? `, ${v.property.city}` : ""}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                        {v.servicePlanName ?? "—"}
                                      </TableCell>
                                      <TableCell>
                                        <StatusBadge status={v.status} />
                                      </TableCell>
                                      <TableCell className="hidden sm:table-cell text-right text-sm font-medium">
                                        {formatCurrency(parseFloat(v.pricePerVisit || "0"))}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </>
                              );
                            })
                          ) : (
                            visits.map(v => (
                              <TableRow
                                key={v.id}
                                data-testid={`row-visit-${v.id}`}
                                className={`cursor-pointer hover:bg-muted/50 transition-colors${v.status === "completed" ? " opacity-60" : ""}`}
                                onClick={() => navigate(`/scheduling?date=${v.scheduledDate}&visitId=${v.id}`)}
                              >
                                <TableCell className="text-sm font-medium whitespace-nowrap">
                                  {formatTime(v.scheduledTime)}
                                </TableCell>
                                <TableCell>
                                  <div className="font-medium text-sm leading-tight">
                                    {v.contact
                                      ? `${v.contact.firstName ?? ""} ${v.contact.lastName ?? ""}`.trim() || "—"
                                      : "—"}
                                  </div>
                                  {v.property?.streetAddress && (
                                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                      {v.property.streetAddress}
                                      {v.property.city ? `, ${v.property.city}` : ""}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                  {v.servicePlanName ?? "—"}
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                  {v.techName ?? <span className="italic">Unassigned</span>}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={v.status} />
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-right text-sm font-medium">
                                  {formatCurrency(parseFloat(v.pricePerVisit || "0"))}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Billing + Up Next */}
            <div className="w-full lg:w-72 xl:w-80 flex flex-col gap-4 shrink-0">
              {/* Today's Billing */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">
                    {isToday ? "Today's" : format(selectedDate, "MMM d") + "'s"} Billing
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isLoading ? (
                    <div className="space-y-2">
                      {[...Array(6)].map((_, i) => (
                        <Skeleton key={i} className="h-5 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm text-muted-foreground">Expected Revenue</span>
                        <span className="font-bold text-base" data-testid="text-expected-revenue">
                          {formatCurrency(billing?.expectedRevenue ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Completed</span>
                        <span className="text-sm font-medium text-green-600 dark:text-green-400" data-testid="text-completed-revenue">
                          {formatCurrency(billing?.completedRevenue ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">In Progress / Pending</span>
                        <span className="text-sm font-medium text-amber-600 dark:text-amber-400" data-testid="text-pending-revenue">
                          {formatCurrency(billing?.pendingRevenue ?? 0)}
                        </span>
                      </div>
                      <div className="border-t pt-3 space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Invoicing
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Invoices Created</span>
                          <span className="text-sm font-medium" data-testid="text-invoices-created">
                            {billing?.invoicesCreatedToday ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Total Invoiced</span>
                          <span className="text-sm font-medium" data-testid="text-total-invoiced">
                            {formatCurrency(billing?.totalInvoiced ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Paid</span>
                          <span className="text-sm font-medium text-green-600 dark:text-green-400" data-testid="text-total-paid">
                            {formatCurrency(billing?.totalPaid ?? 0)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Up Next */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Up Next</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="space-y-3 p-4">
                      {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : upcomingVisits.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground px-4">
                      No upcoming appointments
                    </div>
                  ) : (
                    <div className="divide-y">
                      {upcomingVisits.map(v => (
                        <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`up-next-visit-${v.id}`}>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">
                              {v.contact
                                ? `${v.contact.firstName ?? ""} ${v.contact.lastName ?? ""}`.trim() || "—"
                                : "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatTime(v.scheduledTime)}
                              {v.techName ? ` · ${v.techName}` : ""}
                            </div>
                          </div>
                          <StatusBadge status={v.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="pt-0 pb-3 px-4">
                  <Link href="/scheduling">
                    <a className="text-xs text-primary hover:underline font-medium" data-testid="link-view-all-schedule">
                      View all →
                    </a>
                  </Link>
                </CardFooter>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Map Tab */}
        <TabsContent value="map" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {isToday ? "Today's" : format(selectedDate, "MMM d") + "'s"} Route Map
              </CardTitle>
              <div className="flex items-center gap-2">
                {isToday && (
                  <span className="text-xs text-muted-foreground">
                    Auto-refreshes every minute
                  </span>
                )}
                {googleMapsUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    asChild
                    data-testid="button-open-google-maps"
                  >
                    <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
                      <Navigation className="h-3.5 w-3.5" />
                      Open in Maps
                    </a>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {visits.length === 0 && !isLoading ? (
                <div className="py-16 text-center text-muted-foreground text-sm">
                  No stops to show on the map {isToday ? "today" : `for ${format(selectedDate, "MMM d")}`}
                </div>
              ) : (
                <>
                  <div className="relative rounded-lg overflow-hidden bg-muted min-h-[300px]">
                    {!mapLoaded && (
                      <Skeleton className="absolute inset-0 rounded-lg" />
                    )}
                    <img
                      key={`${selectedDateString}-${mapTick}`}
                      src={mapSrc}
                      alt="Route map"
                      className="w-full rounded-lg object-cover"
                      style={{ display: mapLoaded ? "block" : "none" }}
                      onLoad={() => setMapLoaded(true)}
                      onError={() => setMapLoaded(true)}
                      data-testid="img-daily-map"
                    />
                  </div>
                  <TechLegend visits={visits} />
                  {/* Clickable stop list — labels match the numbered markers on the map */}
                  {visits.filter(v => v.property?.streetAddress).length > 0 && (
                    <div className="mt-4 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Stops — click to open details
                      </p>
                      {visits
                        .filter(v => v.property?.streetAddress)
                        .map((v, idx) => {
                          const label = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[idx] ?? String(idx + 1);
                          const customerName = v.contact
                            ? `${v.contact.firstName ?? ""} ${v.contact.lastName ?? ""}`.trim() || "—"
                            : "—";
                          const address = [v.property?.streetAddress, v.property?.city]
                            .filter(Boolean)
                            .join(", ");
                          return (
                            <button
                              key={v.id}
                              data-testid={`map-stop-${v.id}`}
                              onClick={() => navigate(`/scheduling?date=${v.scheduledDate}&visitId=${v.id}`)}
                              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-muted/60 transition-colors group"
                            >
                              <span className="flex-shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                                {label}
                              </span>
                              <div className="min-w-0 flex-1">
                                <span className="text-sm font-medium group-hover:text-primary transition-colors">
                                  {customerName}
                                </span>
                                {address && (
                                  <span className="text-xs text-muted-foreground ml-2">{address}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <StatusBadge status={v.status} />
                                {v.scheduledTime && (
                                  <span className="text-xs text-muted-foreground">{formatTime(v.scheduledTime)}</span>
                                )}
                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
