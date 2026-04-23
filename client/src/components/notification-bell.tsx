import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl: string | null;
  createdAt: string;
};

const typeColors: Record<string, string> = {
  invoice_paid: "text-green-600 dark:text-green-400",
  visit_completed: "text-blue-600 dark:text-blue-400",
  new_lead: "text-purple-600 dark:text-purple-400",
  payment_failed: "text-red-600 dark:text-red-400",
  invoice_overdue: "text-orange-600 dark:text-orange-400",
  service_paused: "text-yellow-600 dark:text-yellow-400",
  service_resumed: "text-green-600 dark:text-green-400",
  new_message: "text-emerald-600 dark:text-emerald-400",
  general: "text-muted-foreground",
};

export function NotificationBell() {
  const [, navigate] = useLocation();

  const { data: countData } = useQuery<{ count: number; clientRequestCount: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30000,
  });

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const unreadCount = countData?.count || 0;
  const clientRequestCount = countData?.clientRequestCount || 0;
  const recentNotifications = (notifications || []).slice(0, 10);

  const handleClick = (notif: Notification) => {
    if (!notif.isRead) {
      markReadMutation.mutate(notif.id);
    }
    if (notif.linkUrl) {
      navigate(notif.linkUrl);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notification-bell">
          <Bell className="h-4 w-4" />
          {(clientRequestCount > 0 || unreadCount > 0) && (
            <span
              className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-medium"
              data-testid="badge-notification-count"
            >
              {clientRequestCount > 0
                ? (clientRequestCount > 9 ? "9+" : clientRequestCount)
                : (unreadCount > 9 ? "9+" : unreadCount)}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); markAllReadMutation.mutate(); }}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        {clientRequestCount > 0 && (
          <>
            <DropdownMenuItem
              className="flex items-center gap-2 p-2 text-xs cursor-pointer bg-muted/50"
              onClick={() => navigate("/#client-requests")}
              data-testid="link-client-requests"
            >
              <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
              <span className="font-medium">{clientRequestCount} client request{clientRequestCount !== 1 ? "s" : ""} pending</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {recentNotifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground" data-testid="text-no-notifications">
            No notifications yet
          </div>
        ) : (
          recentNotifications.map((notif) => (
            <DropdownMenuItem
              key={notif.id}
              className="flex flex-col items-start gap-1 p-3 cursor-pointer"
              onClick={() => handleClick(notif)}
              data-testid={`notification-item-${notif.id}`}
            >
              <div className="flex items-start gap-2 w-full">
                {!notif.isRead && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${typeColors[notif.type] || ""}`}>
                    {notif.title}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{notif.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {notif.linkUrl && (
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
