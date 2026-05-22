import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Inbox, Link2, EyeOff, Search, ChevronLeft, ChevronRight, Mail } from "lucide-react";
import { useQuery as useContactSearch } from "@tanstack/react-query";
import { format } from "date-fns";

interface InboundEmail {
  id: string;
  tenantId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  matchedContactId: string | null;
  status: "matched" | "unmatched" | "ignored";
  createdAt: string;
}

interface ContactResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function ContactPicker({
  onSelect,
  onClose,
}: {
  onSelect: (contact: ContactResult) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const { data: results, isLoading } = useContactSearch<ContactResult[]>({
    queryKey: ["/api/contacts/search", search],
    queryFn: async () => {
      if (!search.trim()) return [];
      const res = await apiRequest(
        "GET",
        `/api/contacts/search?q=${encodeURIComponent(search)}&limit=10`
      );
      return res.json();
    },
    enabled: search.length >= 1,
  });

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Link to Contact</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            data-testid="input-contact-search"
          />
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {isLoading && <Skeleton className="h-8 w-full" />}
          {!isLoading && results && results.length === 0 && search.trim() && (
            <p className="text-xs text-muted-foreground py-2 text-center">No contacts found</p>
          )}
          {results?.map((c) => (
            <button
              key={c.id}
              className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              onClick={() => onSelect(c)}
              data-testid={`button-select-contact-${c.id}`}
            >
              <span className="font-medium">
                {c.firstName || ""} {c.lastName || ""}
              </span>
              {c.email && <span className="text-muted-foreground ml-2 text-xs">{c.email}</span>}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EmailRow({
  email,
  onLink,
  onIgnore,
}: {
  email: InboundEmail;
  onLink: (email: InboundEmail) => void;
  onIgnore: (email: InboundEmail) => void;
}) {
  const preview = email.bodyText?.replace(/\s+/g, " ").trim().slice(0, 120) || "";
  const fromDisplay = email.fromName
    ? `${email.fromName} <${email.fromAddress}>`
    : email.fromAddress;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 border-b last:border-0"
      data-testid={`row-unmatched-email-${email.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium truncate"
            data-testid={`text-email-subject-${email.id}`}
          >
            {email.subject || "(no subject)"}
          </span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {email.status}
          </Badge>
        </div>
        <p
          className="text-xs text-muted-foreground truncate"
          data-testid={`text-email-from-${email.id}`}
        >
          From: {fromDisplay}
        </p>
        {preview && <p className="text-xs text-muted-foreground line-clamp-2">{preview}</p>}
        <p className="text-xs text-muted-foreground">
          {format(new Date(email.createdAt), "MMM d, yyyy h:mm a")}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onLink(email)}
          data-testid={`button-link-email-${email.id}`}
        >
          <Link2 className="h-3.5 w-3.5 mr-1" />
          Link
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onIgnore(email)}
          data-testid={`button-ignore-email-${email.id}`}
        >
          <EyeOff className="h-3.5 w-3.5 mr-1" />
          Ignore
        </Button>
      </div>
    </div>
  );
}

export default function UnmatchedEmailsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showIgnored, setShowIgnored] = useState(false);
  const [linkTarget, setLinkTarget] = useState<InboundEmail | null>(null);
  const limit = 25;

  const { data: ignoredCountData } = useQuery<{ total: number }>({
    queryKey: ["/api/email/unmatched", "ignored-count"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/email/unmatched?page=1&limit=1&include_ignored=true"
      );
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ data: InboundEmail[]; total: number }>({
    queryKey: ["/api/email/unmatched", { page, limit, showIgnored }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(showIgnored ? { include_ignored: "true" } : {}),
      });
      const res = await apiRequest("GET", `/api/email/unmatched?${params}`);
      return res.json();
    },
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, contactId }: { id: string; contactId: string }) =>
      apiRequest("POST", `/api/email/unmatched/${id}/link`, { contact_id: contactId }).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      setLinkTarget(null);
      toast({ title: "Email linked to contact" });
    },
    onError: () => toast({ title: "Failed to link email", variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/email/unmatched/${id}/ignore`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      toast({ title: "Email ignored" });
    },
    onError: () => toast({ title: "Failed to ignore email", variant: "destructive" }),
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;
  const emails = data?.data ?? [];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Mail className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-unmatched-emails-heading">
            Unmatched Email Review
          </h1>
          <p className="text-sm text-muted-foreground">
            Emails forwarded to your CRM address that could not be matched to a contact
          </p>
        </div>
        {data && data.total > 0 && (
          <Badge className="ml-auto" data-testid="badge-unmatched-count">
            {data.total}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4" />
                Unmatched Emails
              </CardTitle>
              <CardDescription className="mt-1">
                Link an email to a contact to add it to their activity timeline, or ignore it to
                remove it from this queue.
              </CardDescription>
            </div>
            <Button
              variant={showIgnored ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setShowIgnored((v) => !v);
                setPage(1);
              }}
              className="shrink-0"
              data-testid="button-toggle-ignored"
            >
              <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              {showIgnored
                ? "Hide ignored"
                : `Show ignored${ignoredCountData?.total ? ` (${ignoredCountData.total})` : ""}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2"
              data-testid="text-no-unmatched-emails"
            >
              <Inbox className="h-8 w-8 opacity-40" />
              <p className="text-sm">No unmatched emails</p>
            </div>
          ) : (
            <>
              <div>
                {emails.map((email) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    onLink={setLinkTarget}
                    onIgnore={(e) => ignoreMutation.mutate(e.id)}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page <= 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linkTarget} onOpenChange={(o) => !o && setLinkTarget(null)}>
        {linkTarget && (
          <ContactPicker
            onSelect={(contact) =>
              linkMutation.mutate({ id: linkTarget.id, contactId: contact.id })
            }
            onClose={() => setLinkTarget(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
