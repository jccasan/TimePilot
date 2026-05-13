import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShieldCheck } from "lucide-react";
import type { CrmAuditLog } from "@shared/crm-schema";

interface PaginatedResult<T> { data: T[]; total: number; page: number; totalPages: number; }

const entities = ["contact", "company", "deal", "quote", "task", "note", "email", "document", "project", "campaign", "automation", "sequence"];

function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} data-testid="button-crm-audit-prev">Prev</Button>
        <span>{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} data-testid="button-crm-audit-next">Next</Button>
      </div>
    </div>
  );
}

export default function CrmAuditLog() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (entityFilter !== "all") p.set("entity", entityFilter);
    p.set("page", String(page));
    return p.toString();
  }, [search, entityFilter, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmAuditLog>>({
    queryKey: ["/api/crm/audit-logs", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/audit-logs?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const logs = result?.data ?? [];

  function actionColor(action: string) {
    if (action.includes("creat")) return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    if (action.includes("delet")) return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-audit-title">Audit Log</h1>
        <p className="text-muted-foreground mt-1 text-sm">Track all changes made in the CRM.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search actions..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-crm-search-audit" />
        </div>
        <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]" data-testid="select-crm-filter-entity"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12">
          <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No audit log entries yet.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-crm-audit-${log.id}`}>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${actionColor(log.action)}`}>{log.action}</span>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{log.entity}</Badge></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{log.entityId ? log.entityId.slice(0, 8) + "..." : "—"}</TableCell>
                    <TableCell className="text-xs">{log.userId ? log.userId.slice(0, 8) + "..." : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleString() : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} onPageChange={setPage} />}
        </>
      )}
    </div>
  );
}
