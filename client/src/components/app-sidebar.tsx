/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Calendar,
  MapPin,
  FileText,
  DollarSign,
  Calculator,
  Zap,
  MessageSquare,
  BarChart3,
  Activity,
  Settings,
  TrendingUp,
  Building2,
  Map,
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
  Database,
  Plug,
  HelpCircle,
  GraduationCap,
  MessageCircle,
  Lock,
  ClipboardList,
  Users2,
  Kanban,
  Mail,
  MailOpen,
  GitBranch,
  PhoneIncoming,
  CreditCard,
  Sprout,
  Shield,
  Bug,
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
import { useAuth } from "@/hooks/use-auth";
import { getAvailableTours } from "@/components/feature-tour";
import { useTutorialContext } from "@/hooks/use-tutorials";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  requiresSubscription?: boolean;
  requiresVoice?: boolean;
  excludedTiers?: string[];
};

// Nav items accessible to lead_response_operator role
const LR_OPERATOR_NAV: {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { title: "Lead Response", url: "/lead-response", icon: PhoneIncoming },
  { title: "Contacts and Leads", url: "/contacts?leadSource=lead_response", icon: ContactRound },
  { title: "Messages", url: "/communications", icon: MessageSquare },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Billing", url: "/billing", icon: CreditCard },
];

const menuSections: { label: string; key: string; items: MenuItem[] }[] = [
  {
    label: "",
    key: "command",
    items: [
      {
        title: "Command Center",
        url: "/command-center",
        icon: Compass,
        adminOnly: true,
        requiresSubscription: true,
      },
    ],
  },
  {
    label: "Run the Business",
    key: "run",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Customers", url: "/contacts", icon: ContactRound, requiresSubscription: true },
      { title: "Schedule", url: "/scheduling", icon: Calendar, requiresSubscription: true },
      { title: "Routes", url: "/routes", icon: MapPin, requiresSubscription: true },
      { title: "Field Map", url: "/field-view", icon: Map, requiresSubscription: true },
      { title: "Invoices", url: "/invoices", icon: FileText, requiresSubscription: true },
      {
        title: "Messages",
        url: "/communications",
        icon: MessageSquare,
        requiresSubscription: true,
      },
      {
        title: "Unmatched Emails",
        url: "/unmatched-emails",
        icon: MailOpen,
        requiresSubscription: true,
      },
      {
        title: "Quotes",
        url: "/quotes",
        icon: ClipboardList,
        requiresSubscription: true,
      },
    ],
  },
  {
    label: "Make More Money",
    key: "money",
    items: [
      {
        title: "Business Overview",
        url: "/business-overview",
        icon: Activity,
        requiresSubscription: true,
      },
      {
        title: "Profitability",
        url: "/profitability",
        icon: TrendingUp,
        requiresSubscription: true,
      },
      {
        title: "Route Profit Maps",
        url: "/route-profit-maps",
        icon: Map,
        requiresSubscription: true,
      },
      {
        title: "Pricing",
        url: "/pricing",
        icon: Calculator,
        requiresSubscription: true,
      },
      {
        title: "Growth Tools",
        url: "/growth-tools",
        icon: Sprout,
        requiresSubscription: true,
      },
      { title: "Reports", url: "/reports", icon: BarChart3, requiresSubscription: true },
    ],
  },
  {
    label: "CRM",
    key: "crm",
    items: [
      {
        title: "CRM Dashboard",
        url: "/crm",
        icon: Kanban,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Contacts and Leads",
        url: "/crm/contacts",
        icon: Users2,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Companies",
        url: "/crm/companies",
        icon: Building2,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Deals",
        url: "/crm/deals",
        icon: DollarSign,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Pipeline",
        url: "/crm/pipeline",
        icon: BarChart3,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Tasks",
        url: "/crm/tasks",
        icon: ClipboardCheck,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Emails",
        url: "/crm/emails",
        icon: Mail,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Sequences",
        url: "/crm/sequences",
        icon: GitBranch,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Campaigns",
        url: "/crm/campaigns",
        icon: MessageSquare,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
      {
        title: "Reports",
        url: "/crm/reports",
        icon: TrendingUp,
        requiresSubscription: true,
        excludedTiers: ["tier_starter"],
      },
    ],
  },
  {
    label: "Setup",
    key: "setup",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Service Catalog", url: "/pricing/catalog", icon: ClipboardList },
      { title: "Automations", url: "/automation", icon: Zap, requiresSubscription: true },
      { title: "Integrations", url: "/integrations", icon: Plug, requiresSubscription: true },
      { title: "Import Data", url: "/migration", icon: Database, requiresSubscription: true },
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
      try {
        localStorage.setItem("scoopilot_sidebar_collapsed", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  return { collapsed, toggle };
}

export function AppSidebar({
  onStartTour,
  logout,
  isLoggingOut,
  onOpenRover,
}: {
  onStartTour?: (tourId: string) => void;
  logout?: () => void;
  isLoggingOut?: boolean;
  onOpenRover?: () => void;
}) {
  const [location, navigate] = useLocation();
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [generateInvoiceOpen, setGenerateInvoiceOpen] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();
  const { collapsed, toggle } = useSectionCollapse();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const isLeadResponseOperator = user?.role === "lead_response_operator";

  // Determine plan access
  const isPlatformAdmin = user?.isPlatformAdmin ?? false;
  const subscriptionStatus = user?.subscriptionStatus;
  const subscriptionTier = user?.subscriptionTier;
  const voicePlanStatus = user?.voicePlanStatus;
  const crmGrandfathered = user?.crmGrandfathered ?? false;
  const hasMainSubscription =
    isPlatformAdmin || subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const hasVoicePlan = voicePlanStatus === "active";

  const { data: company } = useQuery<{ logoUrl: string | null; name: string }>({
    queryKey: ["/api/company"],
  });
  const { data: unreadSmsData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-sms-count"],
    refetchInterval: 30000,
  });
  const unreadSmsCount = unreadSmsData?.count || 0;

  const { data: uninvoicedData } = useQuery<{ count: number; totalDollars: number }>({
    queryKey: ["/api/company/uninvoiced-summary"],
    refetchInterval: 60000,
  });
  const uninvoicedCount = uninvoicedData?.count || 0;

  const { data: unmatchedEmailData } = useQuery<{ count: number }>({
    queryKey: ["/api/email/unmatched"],
  });
  const unmatchedEmailCount = unmatchedEmailData?.count || 0;
  const tours = getAvailableTours();
  const { startTutorial, allTutorials } = useTutorialContext();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  function isItemLocked(item: MenuItem): boolean {
    if (item.requiresSubscription && !hasMainSubscription) return true;
    if (item.requiresVoice && !hasVoicePlan) return true;
    if (
      item.excludedTiers &&
      subscriptionTier &&
      item.excludedTiers.includes(subscriptionTier) &&
      !crmGrandfathered &&
      !isPlatformAdmin
    )
      return true;
    return false;
  }

  function getLockTooltip(item: MenuItem): string {
    if (item.requiresVoice && !hasVoicePlan)
      return "Add the Voice Agent plan to access this feature";
    if (
      item.excludedTiers &&
      subscriptionTier &&
      item.excludedTiers.includes(subscriptionTier) &&
      !crmGrandfathered
    )
      return "Upgrade to the Solo plan to access CRM features";
    return "Upgrade to full plan to access this feature";
  }

  function handleLockedClick(e: React.MouseEvent) {
    e.preventDefault();
    navigate("/billing");
    handleNavClick();
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/"
          className="flex items-center gap-2 px-2 py-3 cursor-pointer hover:bg-muted/50 rounded-lg transition-colors"
          data-testid="link-sidebar-logo"
          onClick={handleNavClick}
        >
          {company?.logoUrl ? (
            <img
              src={company.logoUrl}
              alt={company.name || "Company"}
              className="h-9 w-9 rounded-md object-cover"
              data-testid="img-tenant-logo"
            />
          ) : (
            <div
              className="h-9 w-9 rounded-md bg-muted flex items-center justify-center"
              data-testid="img-tenant-placeholder"
            >
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="text-lg font-bold truncate" data-testid="text-company-name">
            {company?.name || "My Company"}
          </span>
        </Link>
        <div className="px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full justify-start gap-2"
                size="sm"
                data-testid="button-quick-create"
                disabled={!hasMainSubscription}
                title={
                  !hasMainSubscription ? "Upgrade to full plan to use quick-create" : undefined
                }
              >
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </DropdownMenuTrigger>
            {hasMainSubscription && (
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Quick Create</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setAddContactOpen(true)}
                  data-testid="quick-create-contact"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  New Customer
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigate("/quotes?create=true");
                    handleNavClick();
                  }}
                  data-testid="quick-create-quote"
                >
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  New Quote
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setGenerateInvoiceOpen(true)}
                  data-testid="quick-create-invoice"
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  New Invoice
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigate("/scheduling?addJob=1");
                    handleNavClick();
                  }}
                  data-testid="quick-create-job"
                >
                  <Briefcase className="h-4 w-4 mr-2" />
                  New Job
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
        <AddContactDialog open={addContactOpen} onOpenChange={setAddContactOpen} />
        <GenerateInvoiceDialog
          open={generateInvoiceOpen}
          onOpenChange={setGenerateInvoiceOpen}
          showContactPicker
        />
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pt-1 pb-3">
          <GlobalSearch />
        </div>

        {isLeadResponseOperator ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {LR_OPERATOR_NAV.map((item) => {
                  const isActive =
                    location === item.url ||
                    location.startsWith(item.url.split("?")[0] + "/") ||
                    location.startsWith(item.url.split("?")[0] + "?");
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild data-active={isActive} tooltip={item.title}>
                        <Link
                          href={item.url}
                          data-testid={`link-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}
                          onClick={handleNavClick}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {item.title === "Messages" && unreadSmsCount > 0 && (
                            <Badge
                              variant="default"
                              className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px]"
                              data-testid="badge-sidebar-unread-sms"
                            >
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
          </SidebarGroup>
        ) : (
          <>
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
                        {section.items
                          .filter((item) => !(item as any).adminOnly || isAdmin)
                          .map((item) => {
                            const isActive =
                              item.url === "/"
                                ? location === "/"
                                : location === item.url ||
                                  location.startsWith(item.url + "/") ||
                                  location.startsWith(item.url + "?");

                            const locked = isItemLocked(item);

                            if (locked) {
                              return (
                                <SidebarMenuItem key={item.title}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <SidebarMenuButton
                                        data-testid={`link-${item.title.toLowerCase().replace(/[\s/&]/g, "-")}`}
                                        data-locked="true"
                                        className="opacity-60 cursor-pointer"
                                        onClick={handleLockedClick}
                                      >
                                        <item.icon className="h-4 w-4" />
                                        <span>{item.title}</span>
                                        <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      </SidebarMenuButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-[200px]">
                                      {getLockTooltip(item)}
                                    </TooltipContent>
                                  </Tooltip>
                                </SidebarMenuItem>
                              );
                            }

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
                                      <Badge
                                        variant="default"
                                        className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px]"
                                        data-testid="badge-sidebar-unread-sms"
                                      >
                                        {unreadSmsCount > 99 ? "99+" : unreadSmsCount}
                                      </Badge>
                                    )}
                                    {item.title === "Unmatched Emails" &&
                                      unmatchedEmailCount > 0 && (
                                        <Badge
                                          variant="secondary"
                                          className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                                          data-testid="badge-sidebar-unmatched-emails"
                                        >
                                          {unmatchedEmailCount > 99 ? "99+" : unmatchedEmailCount}
                                        </Badge>
                                      )}
                                    {item.title === "Invoices" && uninvoicedCount > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
                                        data-testid="badge-sidebar-uninvoiced"
                                      >
                                        {uninvoicedCount > 99 ? "99+" : uninvoicedCount}
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
            {isPlatformAdmin && (
              <SidebarGroup>
                <button
                  onClick={() => toggle("platform")}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-collapse-platform"
                >
                  <span>Platform Admin</span>
                  {collapsed["platform"] ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
                {!collapsed["platform"] && (
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {[
                        { title: "Overview", url: "/admin", icon: LayoutDashboard },
                        { title: "Tenants", url: "/admin/tenants", icon: Building2 },
                        { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
                        { title: "Pricing", url: "/admin/pricing", icon: DollarSign },
                        { title: "Messaging", url: "/admin/messaging", icon: MessageSquare },
                        { title: "Errors", url: "/admin/errors", icon: Bug },
                        { title: "Security", url: "/admin/security", icon: Shield },
                      ].map((item) => {
                        const isActive =
                          item.url === "/admin"
                            ? location === "/admin"
                            : location === item.url || location.startsWith(item.url + "/");
                        return (
                          <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton asChild data-active={isActive} tooltip={item.title}>
                              <Link
                                href={item.url}
                                data-testid={`link-admin-${item.title.toLowerCase()}`}
                                onClick={handleNavClick}
                              >
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton data-testid="button-footer-help">
                  <HelpCircle />
                  <span>Help</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                {onOpenRover && (
                  <>
                    <DropdownMenuItem
                      onClick={() => onOpenRover()}
                      data-testid="button-help-ask-rover"
                    >
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Ask Rover
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {onStartTour && (
                  <>
                    <DropdownMenuLabel>Guided Tours</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onStartTour("welcome")}
                      data-testid="button-tour-welcome"
                    >
                      <Compass className="h-4 w-4 mr-2" />
                      Welcome Tour
                    </DropdownMenuItem>
                    {tours
                      .filter((t) => t.id !== "welcome")
                      .map((tour) => (
                        <DropdownMenuItem
                          key={tour.id}
                          onClick={() => onStartTour(tour.id)}
                          data-testid={`button-tour-${tour.id}`}
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          {tour.title}
                        </DropdownMenuItem>
                      ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Step-by-Step Tutorials</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allTutorials.map((tutorial) => (
                  <DropdownMenuItem
                    key={tutorial.id}
                    onClick={() => startTutorial(tutorial.id)}
                    data-testid={`button-tutorial-${tutorial.id}`}
                  >
                    <GraduationCap className="h-4 w-4 mr-2" />
                    {tutorial.title}
                  </DropdownMenuItem>
                ))}
                {logout && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => logout()}
                      disabled={isLoggingOut}
                      data-testid="button-sidebar-logout"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign Out
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
