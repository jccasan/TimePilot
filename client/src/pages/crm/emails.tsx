import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Mail, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import type { CrmEmail, CrmContact } from "@shared/crm-schema";

interface PaginatedResult<T> { data: T[]; total: number; page: number; totalPages: number; }

function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} data-testid="button-crm-emails-prev">Prev</Button>
        <span>{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} data-testid="button-crm-emails-next">Next</Button>
      </div>
    </div>
  );
}

export default function CrmEmails() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [statusFilter] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<CrmEmail | null>(null);
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (directionFilter !== "all") p.set("direction", directionFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    p.set("page", String(page));
    return p.toString();
  }, [search, directionFilter, statusFilter, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmEmail>>({
    queryKey: ["/api/crm/emails", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/emails?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const emails = result?.data ?? [];

  const { data: contactsResult } = useQuery<PaginatedResult<CrmContact>>({
    queryKey: ["/api/crm/contacts", "all"],
    queryFn: async () => { const res = await fetch("/api/crm/contacts?limit=200", { credentials: "include" }); return res.json(); },
  });
  const contacts = contactsResult?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/emails", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/emails"] }); queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] }); setOpen(false); toast({ title: "Email logged" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const contactId = fd.get("contactId") as string;
    createMutation.mutate({
      subject: fd.get("subject") as string,
      body: fd.get("body") as string,
      fromAddress: fd.get("fromAddress") as string,
      toAddress: fd.get("toAddress") as string,
      direction: fd.get("direction") as string,
      status: "sent",
      contactId: contactId !== "none" ? contactId : undefined,
    });
  }

  function formatDate(date: string | Date | null) {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-emails-title">CRM Emails</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track email communications with contacts.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-compose-email">
              <Plus className="w-4 h-4" /> Log Email
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Log Email</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>From</Label><Input name="fromAddress" placeholder="sender@example.com" required data-testid="input-crm-email-from" /></div>
                <div className="space-y-1.5"><Label>To</Label><Input name="toAddress" placeholder="recipient@example.com" required data-testid="input-crm-email-to" /></div>
              </div>
              <div className="space-y-1.5"><Label>Subject</Label><Input name="subject" required data-testid="input-crm-email-subject" /></div>
              <div className="space-y-1.5"><Label>Body</Label><Textarea name="body" rows={5} data-testid="input-crm-email-body" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Direction</Label>
                  <select name="direction" defaultValue="outbound" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="select-crm-email-direction">
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Contact</Label>
                  <select name="contactId" defaultValue="none" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="select-crm-email-contact">
                    <option value="none">No contact</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                  </select>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-crm-submit-email">
                {createMutation.isPending ? "Logging..." : "Log Email"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search emails..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" data-testid="input-crm-search-emails" />
        </div>
        <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]" data-testid="select-crm-filter-direction"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 space-y-1.5">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : emails.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">No emails found.</p>
            </div>
          ) : emails.map((email) => (
            <button
              key={email.id}
              onClick={() => setSelectedEmail(email)}
              className={`w-full text-left p-4 rounded border transition-colors ${selectedEmail?.id === email.id ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/30 hover:bg-muted/30"}`}
              data-testid={`row-crm-email-${email.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {email.direction === "outbound"
                    ? <ArrowUpRight className="w-4 h-4 text-blue-500 shrink-0" />
                    : <ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />}
                  <span className="font-medium text-sm truncate">{email.subject || "(no subject)"}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{formatDate(email.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground truncate">{email.direction === "outbound" ? `To: ${email.toAddress}` : `From: ${email.fromAddress}`}</span>
                <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{email.status}</Badge>
              </div>
            </button>
          ))}
          {result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} onPageChange={setPage} />}
        </div>
        {selectedEmail && (
          <div className="w-80 shrink-0 border border-border/50 rounded-lg p-4 space-y-3" data-testid="panel-crm-email-detail">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Email Detail</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedEmail(null)} data-testid="button-crm-close-email"><span className="sr-only">Close</span>&times;</Button>
            </div>
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Subject: </span>{selectedEmail.subject || "(no subject)"}</div>
              <div><span className="text-muted-foreground">From: </span>{selectedEmail.fromAddress}</div>
              <div><span className="text-muted-foreground">To: </span>{selectedEmail.toAddress}</div>
              <div><span className="text-muted-foreground">Direction: </span>{selectedEmail.direction}</div>
              <div><span className="text-muted-foreground">Status: </span>{selectedEmail.status}</div>
            </div>
            {selectedEmail.body && <div className="border-t border-border/50 pt-3 text-sm text-muted-foreground whitespace-pre-wrap">{selectedEmail.body}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
