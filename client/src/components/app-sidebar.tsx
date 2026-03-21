import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Users,
  Calendar,
  MapPin,
  Smartphone,
  FileText,
  CreditCard,
  DollarSign,
  Calculator,
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
  Map,
  SlidersHorizontal,
  Briefcase,
  HelpCircle,
  Compass,
  Sparkles,
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
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { GlobalSearch } from "@/components/global-search";
import { getAvailableTours } from "@/components/feature-tour";

const menuSections = [
  {
    label: "Main",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Customers", url: "/contacts", icon: Users },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Scheduling", url: "/scheduling", icon: Calendar },
      { title: "Routes", url: "/routes", icon: MapPin },
      { title: "Jobs", url: "/jobs", icon: Briefcase },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Field View", url: "/m/today", icon: Smartphone },
      { title: "Messages", url: "/communications", icon: MessageSquare },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Analytics", url: "/analytics", icon: TrendingUp },
    ],
  },
  {
    label: "Business",
    items: [
      { title: "Profitability", url: "/profitability", icon: TrendingUp },
      { title: "Route Profit Maps", url: "/route-profit-maps", icon: Map },
      { title: "Expenses", url: "/overhead-costs", icon: DollarSign },
    ],
  },
  {
    label: "Pricing Tools",
    items: [
      { title: "Price Calculator", url: "/pricing-calculator", icon: Calculator },
      { title: "Pricing Simulator", url: "/ai-pricing-optimizer", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Billing",
    items: [
      { title: "Pricing", url: "/pricing", icon: DollarSign },
      { title: "Subscription", url: "/billing", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Automation", url: "/automation", icon: Zap },
      { title: "API Keys", url: "/api-keys", icon: Key },
      { title: "Webhooks", url: "/webhooks", icon: Webhook },
      { title: "Data Migration", url: "/migration", icon: ArrowRightLeft },
    ],
  },
];

export function AppSidebar({ onStartTour }: { onStartTour?: (tourId: string) => void }) {
  const [location] = useLocation();
  const { data: company } = useQuery<{ logoUrl: string | null; name: string }>({
    queryKey: ["/api/company"],
  });
  const { data: unreadSmsData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-sms-count"],
    refetchInterval: 30000,
  });
  const unreadSmsCount = unreadSmsData?.count || 0;
  const tours = getAvailableTours();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-3 cursor-pointer hover:bg-muted/50 rounded-lg transition-colors" data-testid="link-sidebar-logo">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name || "Company"} className="h-9 w-9 rounded-md object-cover" data-testid="img-tenant-logo" />
          ) : (
            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center" data-testid="img-tenant-placeholder">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="text-lg font-bold truncate" data-testid="text-company-name">{company?.name || "My Company"}</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <div className="px-3 pt-1 pb-3">
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
                        {item.title === "Messages" && unreadSmsCount > 0 && (
                          <Badge variant="default" className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px]" data-testid="badge-sidebar-unread-sms">
                            {unreadSmsCount > 99 ? "99+" : unreadSmsCount}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {onStartTour && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton data-testid="button-help-tours">
                    <HelpCircle />
                    <span>Take a Tour</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel>Guided Tours</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onStartTour("welcome")}
                    data-testid="button-tour-welcome"
                  >
                    <Compass className="h-4 w-4 mr-2" />
                    Welcome Tour
                  </DropdownMenuItem>
                  {tours.filter(t => t.id !== "welcome").map((tour) => (
                    <DropdownMenuItem
                      key={tour.id}
                      onClick={() => onStartTour(tour.id)}
                      data-testid={`button-tour-${tour.id}`}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {tour.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
