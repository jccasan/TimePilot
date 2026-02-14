import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Calendar,
  MapPin,
  Smartphone,
  FileText,
  CreditCard,
  Zap,
  Key,
  Webhook,
  ExternalLink,
  Footprints,
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
    ],
  },
  {
    label: "Billing",
    items: [
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

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Footprints className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold" data-testid="text-brand-name">Scoopilot</span>
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
      </SidebarContent>
    </Sidebar>
  );
}
