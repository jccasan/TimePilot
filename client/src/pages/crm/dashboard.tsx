import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Building2, TrendingUp, CheckSquare, Mail, FileText, FolderOpen, BarChart3 } from "lucide-react";

interface CrmStats {
  contacts: number;
  companies: number;
  deals: number;
  tasks: number;
  emails: number;
  documents: number;
  projects: number;
  pipelineValue: number;
  wonDeals: number;
}

export default function CrmDashboard() {
  const { data: stats, isLoading } = useQuery<CrmStats>({
    queryKey: ["/api/crm/stats"],
  });

  const tiles = [
    { label: "Contacts", value: stats?.contacts ?? 0, icon: Users, href: "/crm/contacts", color: "text-blue-600 dark:text-blue-400" },
    { label: "Companies", value: stats?.companies ?? 0, icon: Building2, href: "/crm/companies", color: "text-violet-600 dark:text-violet-400" },
    { label: "Open Deals", value: stats?.deals ?? 0, icon: TrendingUp, href: "/crm/deals", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Tasks", value: stats?.tasks ?? 0, icon: CheckSquare, href: "/crm/tasks", color: "text-orange-600 dark:text-orange-400" },
    { label: "Emails", value: stats?.emails ?? 0, icon: Mail, href: "/crm/emails", color: "text-rose-600 dark:text-rose-400" },
    { label: "Documents", value: stats?.documents ?? 0, icon: FileText, href: "/crm/documents", color: "text-amber-600 dark:text-amber-400" },
    { label: "Projects", value: stats?.projects ?? 0, icon: FolderOpen, href: "/crm/projects", color: "text-teal-600 dark:text-teal-400" },
    { label: "Pipeline Value", value: `$${((stats?.pipelineValue ?? 0) / 100).toLocaleString()}`, icon: BarChart3, href: "/crm/pipeline", color: "text-primary" },
  ];

  const quickLinks = [
    { label: "View Pipeline", href: "/crm/pipeline" },
    { label: "Campaigns", href: "/crm/campaigns" },
    { label: "Automations", href: "/crm/automations" },
    { label: "Web Forms", href: "/crm/forms" },
    { label: "Sequences", href: "/crm/sequences" },
    { label: "Reports", href: "/crm/reports" },
    { label: "Audit Log", href: "/crm/audit-log" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-dashboard-title">CRM Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">Sales pipeline, contacts, and customer data at a glance.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link key={tile.label} href={tile.href} data-testid={`card-crm-stat-${tile.label.toLowerCase().replace(/ /g, "-")}`}>
              <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 shrink-0 ${tile.color}`} />
                    <div>
                      <div className="text-xl font-bold tabular-nums">
                        {isLoading ? <span className="text-muted-foreground">...</span> : tile.value}
                      </div>
                      <div className="text-xs text-muted-foreground">{tile.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Quick Access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <Button variant="outline" size="sm" data-testid={`link-crm-quick-${link.label.toLowerCase().replace(/ /g, "-")}`}>
                {link.label}
              </Button>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
