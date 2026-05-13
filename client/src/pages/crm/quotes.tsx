import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { Plus, Search, FileText, Trash2, X, Pencil } from "lucide-react";
import type { CrmQuote, CrmContact } from "@shared/crm-schema";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

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
          data-testid="button-crm-quotes-prev"
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
          data-testid="button-crm-quotes-next"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function CrmQuotes() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editQuote, setEditQuote] = useState<CrmQuote | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [taxRate, setTaxRate] = useState(0);
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);
  const [editTaxRate, setEditTaxRate] = useState(0);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    p.set("page", String(page));
    return p.toString();
  }, [search, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmQuote>>({
    queryKey: ["/api/crm/quotes", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/quotes?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const quotes = result?.data ?? [];

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
      const res = await apiRequest("POST", "/api/crm/quotes", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      setOpen(false);
      setLineItems([{ description: "", quantity: 1, unitPrice: 0 }]);
      setTaxRate(0);
      toast({ title: "Quote created" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/quotes/${id}`, { status });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/crm/quotes/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      setEditQuote(null);
      setEditLineItems([]);
      setEditTaxRate(0);
      toast({ title: "Quote updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/quotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
      toast({ title: "Quote deleted" });
    },
  });

  const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const contactId = fd.get("contactId") as string;
    createMutation.mutate({
      title: fd.get("title") as string,
      items: lineItems.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Math.round(l.unitPrice * 100),
      })),
      subtotal: Math.round(subtotal * 100),
      taxRate,
      taxAmount: Math.round(tax * 100),
      total: Math.round(total * 100),
      contactId: contactId !== "none" ? contactId : undefined,
    });
  }

  function updateLineItem(i: number, key: keyof LineItem, val: string | number) {
    setLineItems((prev) =>
      prev.map((l, idx) =>
        idx === i ? { ...l, [key]: key === "description" ? val : Number(val) } : l
      )
    );
  }

  const statusVariant = (s: string): "default" | "outline" | "destructive" | "secondary" =>
    s === "accepted" ? "default" : s === "rejected" ? "destructive" : "outline";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-quotes-title">
            CRM Quotes
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage CRM quotes and proposals.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-quote">
              <Plus className="w-4 h-4" /> New Quote
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>New Quote</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input name="title" required data-testid="input-crm-quote-title" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <select
                  name="contactId"
                  defaultValue="none"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="select-crm-quote-contact"
                >
                  <option value="none">No contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="mb-2 block">Line Items</Label>
                <div className="space-y-2">
                  {lineItems.map((l, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-12 gap-2 items-center"
                      data-testid={`row-line-item-${i}`}
                    >
                      <Input
                        placeholder="Description"
                        value={l.description}
                        onChange={(e) => updateLineItem(i, "description", e.target.value)}
                        className="col-span-5"
                        data-testid={`input-li-desc-${i}`}
                      />
                      <Input
                        type="number"
                        min="1"
                        value={l.quantity}
                        onChange={(e) => updateLineItem(i, "quantity", e.target.value)}
                        className="col-span-2"
                        placeholder="Qty"
                        data-testid={`input-li-qty-${i}`}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) => updateLineItem(i, "unitPrice", e.target.value)}
                        className="col-span-3"
                        placeholder="Unit $"
                        data-testid={`input-li-price-${i}`}
                      />
                      <div className="col-span-2 flex justify-end">
                        {lineItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              setLineItems((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            data-testid={`button-remove-li-${i}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setLineItems((prev) => [
                      ...prev,
                      { description: "", quantity: 1, unitPrice: 0 },
                    ])
                  }
                  data-testid="button-add-line-item"
                >
                  Add Line
                </Button>
              </div>
              <div className="flex items-center gap-4 justify-end text-sm">
                <div className="flex items-center gap-2">
                  <Label>Tax %</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-20 h-8"
                    data-testid="input-crm-quote-tax"
                  />
                </div>
                <div className="text-muted-foreground">
                  Total: <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-crm-submit-quote"
              >
                {createMutation.isPending ? "Creating..." : "Create Quote"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search quotes..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            data-testid="input-crm-search-quotes"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : quotes.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No quotes yet.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id} data-testid={`row-crm-quote-${q.id}`}>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell>${((q.total || 0) / 100).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(q.status)} className="text-[10px]">
                        {q.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {q.createdAt ? new Date(q.createdAt).toLocaleDateString() : ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {q.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateMutation.mutate({ id: q.id, status: "sent" })}
                            data-testid={`button-crm-send-quote-${q.id}`}
                          >
                            Send
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            const items: LineItem[] = Array.isArray(q.items)
                              ? (q.items as LineItem[]).map((li) => ({
                                  description: li.description,
                                  quantity: li.quantity,
                                  unitPrice: Number(li.unitPrice) / 100,
                                }))
                              : [{ description: "", quantity: 1, unitPrice: 0 }];
                            setEditLineItems(items);
                            setEditTaxRate(q.taxRate ?? 0);
                            setEditQuote(q);
                          }}
                          data-testid={`button-crm-edit-quote-${q.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(q.id)}
                          data-testid={`button-crm-delete-quote-${q.id}`}
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

      {editQuote &&
        (() => {
          const editSubtotal = editLineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
          const editTax = editSubtotal * (editTaxRate / 100);
          const editTotal = editSubtotal + editTax;
          return (
            <Dialog
              open={true}
              onOpenChange={(o) => {
                if (!o) {
                  setEditQuote(null);
                  setEditLineItems([]);
                  setEditTaxRate(0);
                }
              }}
            >
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Edit Quote</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    editMutation.mutate({
                      id: editQuote.id,
                      data: {
                        title: fd.get("title") as string,
                        items: editLineItems.map((l) => ({
                          description: l.description,
                          quantity: l.quantity,
                          unitPrice: Math.round(l.unitPrice * 100),
                        })),
                        subtotal: Math.round(editSubtotal * 100),
                        taxRate: editTaxRate,
                        taxAmount: Math.round(editTax * 100),
                        total: Math.round(editTotal * 100),
                      },
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      name="title"
                      required
                      defaultValue={editQuote.title}
                      data-testid="input-crm-edit-quote-title"
                    />
                  </div>
                  <div>
                    <Label className="mb-2 block">Line Items</Label>
                    <div className="space-y-2">
                      {editLineItems.map((l, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-12 gap-2 items-center"
                          data-testid={`row-edit-line-item-${i}`}
                        >
                          <Input
                            placeholder="Description"
                            value={l.description}
                            onChange={(e) =>
                              setEditLineItems((prev) =>
                                prev.map((li, idx) =>
                                  idx === i ? { ...li, description: e.target.value } : li
                                )
                              )
                            }
                            className="col-span-5"
                            data-testid={`input-edit-li-desc-${i}`}
                          />
                          <Input
                            type="number"
                            min="1"
                            value={l.quantity}
                            onChange={(e) =>
                              setEditLineItems((prev) =>
                                prev.map((li, idx) =>
                                  idx === i ? { ...li, quantity: Number(e.target.value) } : li
                                )
                              )
                            }
                            className="col-span-2"
                            placeholder="Qty"
                            data-testid={`input-edit-li-qty-${i}`}
                          />
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.unitPrice}
                            onChange={(e) =>
                              setEditLineItems((prev) =>
                                prev.map((li, idx) =>
                                  idx === i ? { ...li, unitPrice: Number(e.target.value) } : li
                                )
                              )
                            }
                            className="col-span-3"
                            placeholder="Unit $"
                            data-testid={`input-edit-li-price-${i}`}
                          />
                          <div className="col-span-2 flex justify-end">
                            {editLineItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  setEditLineItems((prev) => prev.filter((_, idx) => idx !== i))
                                }
                                data-testid={`button-remove-edit-li-${i}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        setEditLineItems((prev) => [
                          ...prev,
                          { description: "", quantity: 1, unitPrice: 0 },
                        ])
                      }
                      data-testid="button-add-edit-line-item"
                    >
                      Add Line
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 justify-end text-sm">
                    <div className="flex items-center gap-2">
                      <Label>Tax %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={editTaxRate}
                        onChange={(e) => setEditTaxRate(parseFloat(e.target.value) || 0)}
                        className="w-20 h-8"
                        data-testid="input-crm-edit-quote-tax"
                      />
                    </div>
                    <div className="text-muted-foreground">
                      Total:{" "}
                      <span className="font-semibold text-foreground">${editTotal.toFixed(2)}</span>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={editMutation.isPending}
                    data-testid="button-crm-submit-edit-quote"
                  >
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          );
        })()}
    </div>
  );
}
