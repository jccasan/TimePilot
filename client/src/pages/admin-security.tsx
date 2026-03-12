import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Clock, AlertTriangle, CheckCircle, Trash2, KeyRound, Monitor, User } from "lucide-react";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface AdminUserSecurity {
  id: string;
  email: string;
  passwordChangedAt: string;
  createdAt: string;
  passwordExpired: boolean;
  daysSincePasswordChange: number;
}

interface ActiveSession {
  id: string;
  adminUserId: string;
  adminEmail: string;
  createdAt: string;
  expiresAt: string;
}

interface AuditLogEntry {
  id: string;
  adminUserId: string | null;
  adminEmail: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: any;
  ipAddress: string | null;
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  login_success: "Logged in",
  login_failed: "Failed login attempt",
  revoke_session: "Revoked session",
  change_subscription: "Changed subscription",
  update_subscription_tier: "Updated tier pricing",
  password_changed: "Changed password",
};

const actionColors: Record<string, string> = {
  login_success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  login_failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  revoke_session: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  change_subscription: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  update_subscription_tier: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default function AdminSecurity() {
  const { toast } = useToast();
  const [auditPage, setAuditPage] = useState(0);
  const pageSize = 20;

  const { data: adminUsersData, isLoading: usersLoading } = useQuery<AdminUserSecurity[]>({
    queryKey: ["/api/admin/security/admin-users"],
    queryFn: adminFetchFn("/api/admin/security/admin-users"),
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<ActiveSession[]>({
    queryKey: ["/api/admin/security/sessions"],
    queryFn: adminFetchFn("/api/admin/security/sessions"),
  });

  const { data: auditData, isLoading: auditLoading } = useQuery<{ logs: AuditLogEntry[]; total: number }>({
    queryKey: ["/api/admin/security/audit-log", auditPage],
    queryFn: adminFetchFn(`/api/admin/security/audit-log?limit=${pageSize}&offset=${auditPage * pageSize}`),
  });

  const revokeSession = useMutation({
    mutationFn: async (sessionId: string) => {
      return adminRequest("DELETE", `/api/admin/security/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/audit-log"] });
      toast({ title: "Session revoked" });
    },
  });

  const totalAuditPages = auditData ? Math.ceil(auditData.total / pageSize) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="admin-security-page">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-security">Security</h1>
          <p className="text-sm text-muted-foreground">Admin accounts, active sessions, and audit trail</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-security-policy">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Password Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Min length</span><span className="font-medium">16 characters</span></div>
            <div className="flex justify-between"><span>Complexity</span><span className="font-medium">Upper, lower, number, symbol</span></div>
            <div className="flex justify-between"><span>Expiration</span><span className="font-medium">90 days</span></div>
            <div className="flex justify-between"><span>History check</span><span className="font-medium">Last 10 passwords</span></div>
            <div className="flex justify-between"><span>Session duration</span><span className="font-medium">8 hours</span></div>
          </CardContent>
        </Card>

        <Card data-testid="card-active-sessions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-active-session-count">{sessions?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Currently active admin sessions</p>
          </CardContent>
        </Card>

        <Card data-testid="card-audit-total">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Audit Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-audit-count">{auditData?.total ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Total recorded security events</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-admin-accounts">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Admin Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !adminUsersData?.length ? (
            <p className="text-sm text-muted-foreground">No admin accounts found</p>
          ) : (
            <div className="space-y-3">
              {adminUsersData.map(user => (
                <div key={user.id} className="flex items-center justify-between border rounded-lg px-4 py-3" data-testid={`admin-user-${user.id}`}>
                  <div>
                    <p className="font-medium text-sm">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(user.createdAt)} -- Password changed {user.daysSincePasswordChange}d ago
                    </p>
                  </div>
                  {user.passwordExpired ? (
                    <Badge variant="destructive" className="flex items-center gap-1" data-testid={`badge-pw-expired-${user.id}`}>
                      <AlertTriangle className="h-3 w-3" />
                      Password Expired
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700" data-testid={`badge-pw-ok-${user.id}`}>
                      <CheckCircle className="h-3 w-3" />
                      Secure
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-active-sessions-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-4 w-4" />
            Active Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !sessions?.length ? (
            <p className="text-sm text-muted-foreground">No active sessions</p>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <div key={session.id} className="flex items-center justify-between border rounded-lg px-4 py-3" data-testid={`session-${session.id}`}>
                  <div>
                    <p className="text-sm font-medium">{session.adminEmail}</p>
                    <p className="text-xs text-muted-foreground">
                      Started {timeAgo(session.createdAt)} -- Expires {formatDate(session.expiresAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => revokeSession.mutate(session.id)}
                    disabled={revokeSession.isPending}
                    data-testid={`button-revoke-${session.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-audit-log">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !auditData?.logs?.length ? (
            <p className="text-sm text-muted-foreground">No audit events recorded yet</p>
          ) : (
            <>
              <div className="space-y-2">
                {auditData.logs.map(log => (
                  <div key={log.id} className="flex items-start justify-between border rounded-lg px-4 py-3" data-testid={`audit-${log.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={actionColors[log.action] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"} variant="secondary">
                          {actionLabels[log.action] || log.action}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{log.adminEmail}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(log.createdAt)}</span>
                        {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                        {log.resourceType && (
                          <span>{log.resourceType}{log.resourceId ? `: ${log.resourceId.slice(0, 8)}...` : ""}</span>
                        )}
                      </div>
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                          {JSON.stringify(log.details)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {totalAuditPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditPage === 0}
                    onClick={() => setAuditPage(p => p - 1)}
                    data-testid="button-audit-prev"
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {auditPage + 1} of {totalAuditPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditPage >= totalAuditPages - 1}
                    onClick={() => setAuditPage(p => p + 1)}
                    data-testid="button-audit-next"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}