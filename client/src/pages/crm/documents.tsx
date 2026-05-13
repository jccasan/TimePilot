import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Plus, Search, FileText, Trash2, ExternalLink, Pencil } from "lucide-react";
import type { CrmDocument } from "@shared/crm-schema";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const documentTypes = [
  "contract",
  "proposal",
  "invoice",
  "report",
  "presentation",
  "spreadsheet",
  "image",
  "other",
];

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
          data-testid="button-crm-docs-prev"
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
          data-testid="button-crm-docs-next"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function CrmDocuments() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<CrmDocument | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (typeFilter !== "all") p.set("type", typeFilter);
    p.set("page", String(page));
    return p.toString();
  }, [search, typeFilter, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmDocument>>({
    queryKey: ["/api/crm/documents", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/documents?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const documents = result?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/documents", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      setOpen(false);
      toast({ title: "Document added" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/crm/documents/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/documents"] });
      setEditDoc(null);
      toast({ title: "Document updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      toast({ title: "Document deleted" });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name") as string,
      type: (fd.get("type") as string) || "other",
      url: (fd.get("url") as string) || "",
      size: 0,
    });
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-documents-title">
            CRM Documents
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Contracts, proposals, and attached files.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-document">
              <Plus className="w-4 h-4" /> Add Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Document Link</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input name="name" required data-testid="input-crm-doc-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select name="type" defaultValue="other">
                  <SelectTrigger data-testid="select-crm-doc-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>URL (optional)</Label>
                <Input name="url" placeholder="https://..." data-testid="input-crm-doc-url" />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-crm-submit-document"
              >
                {createMutation.isPending ? "Adding..." : "Add Document"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search documents..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            data-testid="input-crm-search-documents"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]" data-testid="select-crm-filter-doc-type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {documentTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No documents yet.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id} data-testid={`row-crm-doc-${doc.id}`}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {doc.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatSize(doc.size)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {doc.url && (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7"
                              data-testid={`button-crm-open-doc-${doc.id}`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditDoc(doc)}
                          data-testid={`button-crm-edit-doc-${doc.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(doc.id)}
                          data-testid={`button-crm-delete-doc-${doc.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
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

      <Dialog
        open={!!editDoc}
        onOpenChange={(o) => {
          if (!o) setEditDoc(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>
          {editDoc && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                updateMutation.mutate({
                  id: editDoc.id,
                  data: {
                    name: fd.get("name") as string,
                    url: (fd.get("url") as string) || "",
                    type: fd.get("type") as string,
                  },
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  name="name"
                  required
                  defaultValue={editDoc.name}
                  data-testid="input-crm-edit-doc-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select name="type" defaultValue={editDoc.type ?? "other"}>
                  <SelectTrigger data-testid="select-crm-edit-doc-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>URL (optional)</Label>
                <Input
                  name="url"
                  placeholder="https://..."
                  defaultValue={editDoc.url ?? ""}
                  data-testid="input-crm-edit-doc-url"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={updateMutation.isPending}
                data-testid="button-crm-submit-edit-document"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
