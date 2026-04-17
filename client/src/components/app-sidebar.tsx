import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Calendar,
  MapPin,
  Smartphone,
  FileText,
  CreditCard,
  DollarSign,
  Calculator,
  Zap,
  MessageSquare,
  BarChart3,
  Settings,
  TrendingUp,
  Building2,
  Map,
  Columns,
  HelpCircle,
  Compass,
  Sparkles,
  ClipboardCheck,
  ContactRound,
  Plus,
  UserPlus,
  Receipt,
  LogOut,
  ChevronDown,
  ChevronRight,
  Briefcase,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
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
import { AddContactDialog } from "@/components/add-contact-dialog";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";

const menuSections = [
  {
    label: null,
    key: "main",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "CRM",
    key: "crm",
    items: [
      { title: "Contacts", url: "/contacts", icon: ContactRound },
      { title: "Pipeline", url: "/pipeline", icon: Columns },
      { title: "Quotes & Proposals", url: "/quotes", icon: ClipboardCheck },
      { title: "Messages", url: "/communications", icon: MessageSquare },
    ],
  },
  {
    label: "Operations",
    key: "operations",
    items: [
      { title: "Scheduling", url: "/scheduling", icon: Calendar },
      { title: "Routes", url: "/routes", icon: MapPin },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Reports & Analytics", url: "/reports", icon: BarChart3 },
      { title: "Field View", url: "/m/today", icon: Smartphone },
    ],
  },
  {
    label: "Business",
    key: "business",
    items: [
      { title: "Profitability", url: "/profitability", icon: TrendingUp },
      { title: "Route Profit Maps", url: "/route-profit-maps", icon: Map },
      { title: "Expenses", url: "/overhead-costs", icon: DollarSign },
      { title: "Pricing Tools", url: "/pricing-calculator", icon: Calculator },
      { title: "Pricing Plans", url: "/pricing", icon: DollarSign },
      { title: "Subscription", url: "/billing", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    key: "settings",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Automation", url: "/automation", icon: Zap },
    ],
  },
];

function useSectionCollapse() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("scoopilot_sidebar_collapsed");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("scoopilot_sidebar_collapsed", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return { collapsed, toggle };
}

export function AppSidebar({ onStartTour, logout, isLoggingOut }: { onStartTour?: (tourId: string) => void; logout?: () => void; isLoggingOut?: boolean }) {
  const [location, navigate] = useLocation();
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [generateInvoiceOpen, setGenerateInvoiceOpen] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();
  const { collapsed, toggle } = useSectionCollapse();

  const { data: company } = useQuery<{ logoUrl: string | null; name: string }>({
    queryKey: ["/api/company"],
  });
  const { data: unreadSmsData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-sms-count"],
    refetchInterval: 30000,
  });
  const unreadSmsCount = unreadSmsData?.count || 0;
  const tours = getAvailableTours();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-3 cursor-pointer hover:bg-muted/50 rounded-lg transition-colors" data-testid="link-sidebar-logo" onClick={handleNavClick}>
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name || "Company"} className="h-9 w-9 rounded-md object-cover" data-testid="img-tenant-logo" />
          ) : (
            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center" data-testid="img-tenant-placeholder">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="text-lg font-bold truncate" data-testid="text-company-name">{company?.name || "My Company"}</span>
        </Link>
        <div className="px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="w-full justify-start gap-2" size="sm" data-testid="button-quick-create">
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Quick Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAddContactOpen(true)} data-testid="quick-create-contact">
                <UserPlus className="h-4 w-4 mr-2" />
                New Contact
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigate("/quotes?create=true"); handleNavClick(); }} data-testid="quick-create-quote">
                <ClipboardCheck className="h-4 w-4 mr-2" />
                New Quote
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGenerateInvoiceOpen(true)} data-testid="quick-create-invoice">
                <Receipt className="h-4 w-4 mr-2" />
                New Invoice
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigate("/scheduling?addJob=1"); handleNavClick(); }} data-testid="quick-create-job">
                <Briefcase className="h-4 w-4 mr-2" />
                New Job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <AddContactDialog open={addContactOpen} onOpenChange={setAddContactOpen} />
        <GenerateInvoiceDialog open={generateInvoiceOpen} onOpenChange={setGenerateInvoiceOpen} showContactPicker />
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pt-1 pb-3">
          <GlobalSearch />
        </div>

        {menuSections.map((section) => {
          const isCollapsed = section.label ? (collapsed[section.key] ?? false) : false;

          return (
            <SidebarGroup key={section.key}>
              {section.label && (
                <button
                  onClick={() => toggle(section.key)}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-collapse-${section.key}`}
                >
                  <span>{section.label}</span>
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              )}

              {!isCollapsed && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isActive = item.url === "/"
                        ? location === "/"
                        : location === item.url || location.startsWith(item.url + "/") || location.startsWith(item.url + "?");

                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            data-active={isActive}
                            tooltip={item.title}
                          >
                            <Link
                              href={item.url}
                              data-testid={`link-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}
                              onClick={handleNavClick}
                            >
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
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {onStartTour && (
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
                  <DropdownMenuItem onClick={() => onStartTour("welcome")} data-testid="button-tour-welcome">
                    <Compass className="h-4 w-4 mr-2" />
                    Welcome Tour
                  </DropdownMenuItem>
                  {tours.filter(t => t.id !== "welcome").map((tour) => (
                    <DropdownMenuItem key={tour.id} onClick={() => onStartTour(tour.id)} data-testid={`button-tour-${tour.id}`}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {tour.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
          {logout && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => logout()} disabled={isLoggingOut} data-testid="button-sidebar-logout">
                <LogOut />
                <span>Sign Out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
