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
  Shield,
} from "lucide-react";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";
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
    ],
  },
  {
    label: "Billing",
    items: [
      { title: "Pricing", url: "/pricing", icon: DollarSign },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Subscription", url: "/billing", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Automation", url: "/automation", icon: Zap },
      { title: "API Keys", url: "/api-keys", icon: Key },
      { title: "Webhooks", url: "/webhooks", icon: Webhook },
    ],
  },
  {
    label: "Portal",
    items: [
      { title: "Client Portal", url: "/portal", icon: ExternalLink },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  const { data: adminCheck } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
    retry: false,
    staleTime: Infinity,
  });

  const isAdmin = adminCheck?.isAdmin === true;

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={logoSquare} alt="ScooPilot" className="h-8 w-8 rounded-md object-cover" data-testid="img-brand-logo" />
          <span className="text-lg font-bold" data-testid="text-brand-name">ScooPilot</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    data-active={location === "/admin" || location.startsWith("/admin/")}
                    tooltip="Admin"
                  >
                    <Link href="/admin" data-testid="link-admin">
                      <Shield />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
