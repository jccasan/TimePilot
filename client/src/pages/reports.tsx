import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp, DollarSign, Users, FileText,
  CalendarCheck, BarChart3,
} from "lucide-react";

type ReportData = {
  monthlyRevenue: { month: string; revenue: number }[];
  contactsByStatus: Record<string, number>;
  totalContacts: number;
  invoicesByStatus: Record<string, number>;
  totalInvoices: number;
  totalOutstanding: number;
  totalCollected: number;
  thisMonthVisits: {
    completed: number;
    scheduled: number;
    skipped: number;
    total: number;
  };
};

const statusLabels: Record<string, string> = {
  lead: "Lead",
  estimate: "Estimate",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  sent: "Sent",
  paid: "Paid",
  failed: "Failed",
  void: "Void",
};

export default function Reports() {
  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/reports/summary"],
  });

  const maxRevenue = data ? Math.max(...data.monthlyRevenue.map(m => m.revenue), 1) : 1;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-reports-heading">Reports</h1>
        <p className="text-muted-foreground">Business performance overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-collected">
                ${(data?.totalCollected ?? 0).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-outstanding">
                ${(data?.totalOutstanding ?? 0).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-contacts">
                {data?.totalContacts ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Revenue (Last 6 Months)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              <div className="space-y-3" data-testid="chart-monthly-revenue">
                {data?.monthlyRevenue.map((m) => (
                  <div key={m.month} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground min-w-[100px]">{m.month}</span>
                      <span className="font-medium">${m.revenue.toFixed(2)}</span>
                    </div>
                    <Progress value={(m.revenue / maxRevenue) * 100} className="h-2" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">This Month's Visits</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-4" data-testid="chart-visits">
                <div className="text-3xl font-bold">{data?.thisMonthVisits.total ?? 0}</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Completed</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.completed ?? 0}</Badge>
                  </div>
                  <Progress
                    value={data?.thisMonthVisits.total ? (data.thisMonthVisits.completed / data.thisMonthVisits.total) * 100 : 0}
                    className="h-2"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Scheduled</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.scheduled ?? 0}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Skipped</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.skipped ?? 0}</Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Contacts by Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2" data-testid="chart-contacts-status">
                {Object.entries(data?.contactsByStatus ?? {}).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{statusLabels[status] || status}</span>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={data?.totalContacts ? (cnt / data.totalContacts) * 100 : 0}
                        className="h-2 w-24"
                      />
                      <Badge variant="secondary">{cnt}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Invoices by Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2" data-testid="chart-invoices-status">
                {Object.entries(data?.invoicesByStatus ?? {}).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{invoiceStatusLabels[status] || status}</span>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={data?.totalInvoices ? (cnt / data.totalInvoices) * 100 : 0}
                        className="h-2 w-24"
                      />
                      <Badge variant="secondary">{cnt}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
