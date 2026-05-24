import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, TrendingUp, Trash2, Upload } from "lucide-react";
import type { CrmDeal, CrmContact } from "@shared/crm-schema";
import { CrmImportModal } from "@/components/crm-import-modal";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];
const stageBadgeVariant = (s: string): "default" | "outline" | "destructive" | "secondary" =>
  s === "closed_won" ? "default" : s === "closed_lost" ? "destructive" : "outline";

function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          data-testid="button-crm-deals-prev"
        >
          Prev
        </Button>
        <span>
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          data-testid="button-crm-deals-next"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function CrmDeals() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (stageFilter !== "all") p.set("stage", stageFilter);
    p.set("page", String(page));
    return p.toString();
  }, [search, stageFilter, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmDeal>>({
    queryKey: ["/api/crm/deals", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
  });
  const deals = result?.data ?? [];

  const { data: contactsResult } = useQuery<PaginatedResult<CrmContact>>({
    queryKey: ["/api/crm/contacts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/crm/contacts?limit=200", { credentials: "include" });
      return res.json();
    },
  });
  const contacts = contactsResult?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/deals", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      setOpen(false);
      toast({ title: "Deal created" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/deals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      toast({ title: "Deal deleted" });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const contactId = fd.get("contactId") as string;
    createMutation.mutate({
      title: fd.get("title") as string,
      value: parseInt((fd.get("value") as string) || "0") * 100,
      stage: (fd.get("stage") as string) || "lead",
      description: (fd.get("description") as string) || undefined,
      contactId: contactId !== "none" ? contactId : undefined,
    });
  }

  const totalPipelineValue = deals.reduce((s, d) => s + (d.value || 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-deals-title">
            CRM Deals
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {deals.length > 0 && `Pipeline value: $${(totalPipelineValue / 100).toLocaleString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crm/pipeline">
            <Button variant="outline" size="sm" data-testid="button-crm-view-pipeline">
              View Pipeline Board
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setImportOpen(true)}
            data-testid="button-crm-import-deals"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-deal">
                <Plus className="w-4 h-4" /> Add Deal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Deal</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input name="title" required data-testid="input-crm-deal-title" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Value ($)</Label>
                    <Input
                      name="value"
                      type="number"
                      min="0"
                      defaultValue="0"
                      data-testid="input-crm-deal-value"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Stage</Label>
                    <Select name="stage" defaultValue="lead">
                      <SelectTrigger data-testid="select-crm-deal-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Contact</Label>
                  <select
                    name="contactId"
                    defaultValue="none"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    data-testid="select-crm-deal-contact"
                  >
                    <option value="none">No contact</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                  data-testid="button-crm-submit-deal"
                >
                  {createMutation.isPending ? "Creating..." : "Create Deal"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search deals..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            data-testid="input-crm-search-deals"
          />
        </div>
        <Select
          value={stageFilter}
          onValueChange={(v) => {
            setStageFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]" data-testid="select-crm-filter-stage">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {stages.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : deals.length === 0 ? (
        <div className="text-center py-12">
          <TrendingUp className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No deals found.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Probability</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map((deal) => (
                  <TableRow key={deal.id} data-testid={`row-crm-deal-${deal.id}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/crm/deals/${deal.id}`}
                        className="hover:text-primary hover:underline"
                        data-testid={`link-crm-deal-${deal.id}`}
                      >
                        {deal.title}
                      </Link>
                    </TableCell>
                    <TableCell>${((deal.value || 0) / 100).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={stageBadgeVariant(deal.stage)} className="text-[10px]">
                        {deal.stage.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{deal.probability || 0}%</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {deal.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(deal.id)}
                        data-testid={`button-crm-delete-deal-${deal.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
      <CrmImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        entityLabel="Deal"
        templateUrl="/api/crm/deals/import/template"
        importUrl="/api/crm/deals/import"
        invalidateKeys={["/api/crm/deals", "/api/crm/stats"]}
      />
    </div>
  );
}
