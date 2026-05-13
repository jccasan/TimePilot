import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead", qualified: "Qualified", proposal: "Proposal",
  negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};
const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#22c55e", "#ef4444"];
const PIE_COLORS = ["#f07f1e", "#00C2D6", "#6366f1", "#22c55e", "#ef4444", "#8b5cf6"];

type PipelineData = { stage: string; count: number; value: number }[];
type DealsData = { month: string; won: number; lost: number }[];
type ContactsData = { source: string; count: number }[];
type TasksData = { status: string; count: number }[];

const fetchJson = async (url: string) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
};

const Loading = () => <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Loading...</div>;

export default function CrmReports() {
  const { data: pipeline, isLoading: loadingPipeline } = useQuery<PipelineData>({
    queryKey: ["/api/crm/reports/pipeline"],
    queryFn: () => fetchJson("/api/crm/reports/pipeline"),
  });
  const { data: dealsOverTime, isLoading: loadingDeals } = useQuery<DealsData>({
    queryKey: ["/api/crm/reports/deals"],
    queryFn: () => fetchJson("/api/crm/reports/deals"),
  });
  const { data: contactsBySource, isLoading: loadingContacts } = useQuery<ContactsData>({
    queryKey: ["/api/crm/reports/contacts"],
    queryFn: () => fetchJson("/api/crm/reports/contacts"),
  });
  const { data: taskStats, isLoading: loadingTasks } = useQuery<TasksData>({
    queryKey: ["/api/crm/reports/tasks"],
    queryFn: () => fetchJson("/api/crm/reports/tasks"),
  });

  const pipelineChartData = (pipeline || []).map((d) => ({ ...d, stage: STAGE_LABELS[d.stage] || d.stage }));
  const contactsPieData = (contactsBySource || []).filter((d) => d.count > 0);
  const totalTasks = (taskStats || []).reduce((s, t) => s + t.count, 0);
  const completedTasks = (taskStats || []).find((t) => t.status === "completed")?.count || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const tasksPieData = (taskStats || []).filter((d) => d.count > 0).map((d) => ({
    name: d.status === "in_progress" ? "In Progress" : d.status.charAt(0).toUpperCase() + d.status.slice(1),
    value: d.count,
  }));
  const totalPipelineValue = (pipeline || []).reduce((s, d) => s + d.value, 0);
  const wonValue = (pipeline || []).find((d) => d.stage === "closed_won")?.value || 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-reports-title">CRM Reports</h1>
        <p className="text-muted-foreground mt-1 text-sm">Pipeline analytics and performance overview.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-crm-pipeline-value">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground">Pipeline Value</div>
            <div className="text-2xl font-bold">${(totalPipelineValue / 100).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-crm-won-value">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground">Won Value</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">${(wonValue / 100).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-crm-task-completion">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground">Task Completion</div>
            <div className="text-2xl font-bold">{completionRate}%</div>
          </CardContent>
        </Card>
        <Card data-testid="card-crm-total-contacts">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground">Total Contacts</div>
            <div className="text-2xl font-bold">{contactsBySource?.reduce((s, c) => s + c.count, 0) || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-crm-pipeline-chart">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline by Stage</CardTitle></CardHeader>
          <CardContent>
            {loadingPipeline ? <Loading /> : pipelineChartData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data yet</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={pipelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Deals" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-crm-contacts-chart">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Contacts by Source</CardTitle></CardHeader>
          <CardContent>
            {loadingContacts ? <Loading /> : contactsPieData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data yet</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={contactsPieData} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={80} label={({ source, percent }) => `${source} (${Math.round((percent || 0) * 100)}%)`} labelLine={false}>
                    {contactsPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-crm-deals-chart">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Deals Won vs Lost</CardTitle></CardHeader>
          <CardContent>
            {loadingDeals ? <Loading /> : !dealsOverTime?.length ? <p className="text-sm text-muted-foreground text-center py-8">No closed deals yet</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dealsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="won" fill="#22c55e" radius={[4, 4, 0, 0]} name="Won" />
                  <Bar dataKey="lost" fill="#ef4444" radius={[4, 4, 0, 0]} name="Lost" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-crm-tasks-chart">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Task Status</CardTitle></CardHeader>
          <CardContent>
            {loadingTasks ? <Loading /> : tasksPieData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No tasks yet</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={tasksPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {tasksPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
