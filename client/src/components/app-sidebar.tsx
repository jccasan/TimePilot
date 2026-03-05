import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Calendar,
  MapPin,
  Smartphone,
  FileText,
  CreditCard,
  DollarSign,
  Zap,
  Key,
  Webhook,
  ExternalLink,
  MessageSquare,
  BarChart3,
  Settings,
  TrendingUp,
  Building2,
  ArrowRightLeft,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { GlobalSearch } from "@/components/global-search";

const menuSections = [
  {
    label: "Main",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "CRM / Contacts", url: "/contacts", icon: Users },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Scheduling", url: "/scheduling", icon: Calendar },
      { title: "Routes", url: "/routes", icon: MapPin },
      { title: "Tech Mobile", url: "/m/today", icon: Smartphone },
      { title: "Communications", url: "/communications", icon: MessageSquare },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Analytics", url: "/analytics", icon: TrendingUp },
    ],
  },
  {
    label: "Billing",
    items: [
      { title: "Pricing", url: "/pricing", icon: DollarSign },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Scoopilot Subscription", url: "/billing", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Automation", url: "/automation", icon: Zap },
      { title: "API Keys", url: "/api-keys", icon: Key },
      { title: "Webhooks", url: "/webhooks", icon: Webhook },
      { title: "Client Portal", url: "/portal", icon: ExternalLink },
      { title: "Data Migration", url: "/migration", icon: ArrowRightLeft },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: company } = useQuery<{ logoUrl: string | null; name: string }>({
    queryKey: ["/api/company"],
  });

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name || "Company"} className="h-8 w-8 rounded-md object-cover" data-testid="img-tenant-logo" />
          ) : (
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center" data-testid="img-tenant-placeholder">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="text-lg font-bold truncate" data-testid="text-company-name">{company?.name || "My Company"}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <div className="px-3 py-2">
          <GlobalSearch />
        </div>
        {menuSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={location === item.url}
                      tooltip={item.title}
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/[\s/]/g, "-")}`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
