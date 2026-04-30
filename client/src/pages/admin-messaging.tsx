import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  HardDrive,
  AlertTriangle,
  Trash2,
  Loader2,
  Building2,
  Clock,
  ArrowRight,
} from "lucide-react";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

type MessagingAnalytics = {
  overview: {
    totalMessages: number;
    smsMessages: number;
    emailMessages: number;
    inbound: number;
    outbound: number;
    last30Days: number;
  };
  storage: {
    totalAttachments: number;
    totalOriginalBytes: number;
    totalCompressedBytes: number;
    compressionSavingsBytes: number;
    compressionSavingsPct: number;
  };
  exceptions: {
    total: number;
    unresolved: number;
  };
  perTenant: Array<{
    companyId: string;
    companyName: string;
    retentionDays: number;
    totalMessages: number;
    smsMessages: number;
    emailMessages: number;
    attachments: number;
    storageBytes: number;
  }>;
};

type MessageException = {
  id: string;
  fromAddress: string;
  toAddress: string;
  body: string | null;
  reason: string;
  candidateCompanyIds: string[];
  resolvedAt: string | null;
  createdAt: string;
};

export default function AdminMessaging() {
  const { toast } = useToast();
  const [editingRetention, setEditingRetention] = useState<string | null>(null);
  const [retentionValue, setRetentionValue] = useState("");

  const { data: analytics, isLoading } = useQuery<MessagingAnalytics>({
    queryKey: ["/api/admin/analytics/messaging"],
    queryFn: adminFetchFn("/api/admin/analytics/messaging"),
  });

  const { data: exceptions } = useQuery<MessageException[]>({
    queryKey: ["/api/admin/message-exceptions"],
    queryFn: adminFetchFn("/api/admin/message-exceptions"),
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await adminRequest("POST", "/api/admin/messaging/run-cleanup");
      if (!res.ok) throw new Error("Cleanup failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Cleanup completed",
        description: `Deleted ${data.messagesDeleted} messages, ${data.attachmentsDeleted} attachments, ${data.smsRecordsDeleted} SMS records. Reclaimed ~${formatBytes(data.storageBytesReclaimed)}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/messaging"] });
    },
    onError: () => {
      toast({ title: "Cleanup failed", variant: "destructive" });
    },
  });

  const updateRetentionMutation = useMutation({
    mutationFn: async ({ companyId, days }: { companyId: string; days: number }) => {
      const res = await adminRequest(
        "PATCH",
        `/api/admin/companies/${companyId}/messaging-config`,
        { messageRetentionDays: days }
      );
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      setEditingRetention(null);
      toast({ title: "Retention period updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/messaging"] });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await adminRequest("POST", `/api/admin/message-exceptions/${id}/dismiss`);
      if (!res.ok) throw new Error("Dismiss failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/message-exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/messaging"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ exceptionId, companyId }: { exceptionId: string; companyId: string }) => {
      const res = await adminRequest(
        "POST",
        `/api/admin/message-exceptions/${exceptionId}/resolve`,
        { companyId }
      );
      if (!res.ok) throw new Error("Resolve failed");
      return res.json();
    },
    onSuccess: () => {
      setResolveTarget({});
      toast({ title: "Exception resolved and message routed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/message-exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/messaging"] });
    },
    onError: () => {
      toast({ title: "Failed to resolve exception", variant: "destructive" });
    },
  });

  const [resolveTarget, setResolveTarget] = useState<Record<string, string>>({});
  const unresolvedExceptions = (exceptions || []).filter((e) => !e.resolvedAt);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-messaging">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-messaging-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-messaging-title">
            Messaging Monitor
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Message volume, storage, retention, and exception queue
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => cleanupMutation.mutate()}
          disabled={cleanupMutation.isPending}
          data-testid="button-run-cleanup"
        >
          {cleanupMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Run Cleanup Now
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Messages</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-total-messages">
              {analytics?.overview.totalMessages ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Last 30d: {analytics?.overview.last30Days ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">SMS / Email</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-channel-split">
              {analytics?.overview.smsMessages ?? 0} / {analytics?.overview.emailMessages ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              In: {analytics?.overview.inbound ?? 0} | Out: {analytics?.overview.outbound ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Attachment Storage</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-storage-used">
              {formatBytes(analytics?.storage.totalCompressedBytes ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {analytics?.storage.totalAttachments ?? 0} files | Saved{" "}
              {analytics?.storage.compressionSavingsPct ?? 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Exception Queue</span>
            </div>
            <p className="text-xl font-bold" data-testid="text-exceptions-unresolved">
              {analytics?.exceptions.unresolved ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Total: {analytics?.exceptions.total ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {unresolvedExceptions.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800" data-testid="card-exception-queue">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Unresolved Exceptions ({unresolvedExceptions.length})
            </CardTitle>
            <CardDescription>Messages that could not be automatically routed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-auto">
              {unresolvedExceptions.slice(0, 20).map((exc) => (
                <div
                  key={exc.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-background"
                  data-testid={`exception-row-${exc.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">{exc.fromAddress}</span>
                      <span className="text-muted-foreground">-&gt;</span>
                      <span className="truncate">{exc.toAddress}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{exc.reason}</p>
                    {exc.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {exc.body.slice(0, 100)}
                      </p>
                    )}
                    {exc.candidateCompanyIds.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Candidates:{" "}
                        {exc.candidateCompanyIds
                          .map((id) => {
                            const tenant = analytics?.perTenant.find((t) => t.companyId === id);
                            return tenant?.companyName || id.slice(0, 8);
                          })
                          .join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(exc.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Select
                      value={resolveTarget[exc.id] || ""}
                      onValueChange={(val) =>
                        setResolveTarget((prev) => ({ ...prev, [exc.id]: val }))
                      }
                    >
                      <SelectTrigger
                        className="h-7 w-[140px] text-xs"
                        data-testid={`select-resolve-tenant-${exc.id}`}
                      >
                        <SelectValue placeholder="Route to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(analytics?.perTenant ?? []).map((t) => (
                          <SelectItem key={t.companyId} value={t.companyId}>
                            {t.companyName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        const targetId = resolveTarget[exc.id];
                        if (targetId)
                          resolveMutation.mutate({ exceptionId: exc.id, companyId: targetId });
                      }}
                      disabled={!resolveTarget[exc.id] || resolveMutation.isPending}
                      data-testid={`button-resolve-${exc.id}`}
                    >
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => dismissMutation.mutate(exc.id)}
                      disabled={dismissMutation.isPending}
                      data-testid={`button-dismiss-${exc.id}`}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-per-tenant">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Per-Tenant Messaging
          </CardTitle>
          <CardDescription>
            Message volume, storage usage, and retention settings by tenant
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(analytics?.perTenant ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No messaging data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
                      Tenant
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Messages
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">SMS</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Attachments
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Storage
                    </th>
                    <th className="text-right py-2 pl-3 font-medium text-muted-foreground">
                      Retention
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.perTenant ?? []).map((t) => (
                    <tr
                      key={t.companyId}
                      className="border-b last:border-0"
                      data-testid={`tenant-row-${t.companyId}`}
                    >
                      <td className="py-2 pr-4">
                        <span className="font-medium truncate block max-w-[200px]">
                          {t.companyName}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3">{t.totalMessages}</td>
                      <td className="text-right py-2 px-3">{t.smsMessages}</td>
                      <td className="text-right py-2 px-3">{t.emailMessages}</td>
                      <td className="text-right py-2 px-3">{t.attachments}</td>
                      <td className="text-right py-2 px-3">{formatBytes(t.storageBytes)}</td>
                      <td className="text-right py-2 pl-3">
                        {editingRetention === t.companyId ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Input
                              type="number"
                              min={1}
                              max={365}
                              value={retentionValue}
                              onChange={(e) => setRetentionValue(e.target.value)}
                              className="w-16 h-7 text-xs"
                              data-testid={`input-retention-${t.companyId}`}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                const days = parseInt(retentionValue, 10);
                                if (days >= 1 && days <= 365) {
                                  updateRetentionMutation.mutate({ companyId: t.companyId, days });
                                }
                              }}
                              data-testid={`button-save-retention-${t.companyId}`}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setEditingRetention(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <button
                            className="flex items-center gap-1 text-xs hover:underline cursor-pointer ml-auto"
                            onClick={() => {
                              setEditingRetention(t.companyId);
                              setRetentionValue(String(t.retentionDays));
                            }}
                            data-testid={`button-edit-retention-${t.companyId}`}
                          >
                            <Clock className="h-3 w-3" />
                            {t.retentionDays}d
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
