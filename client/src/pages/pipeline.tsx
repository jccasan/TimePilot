import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Phone, Mail, Dog } from "lucide-react";

const COLUMNS: { key: Contact["status"]; label: string; color: string; bgClass: string }[] = [
  { key: "lead", label: "Lead", color: "bg-blue-500", bgClass: "bg-blue-50 dark:bg-blue-950/30" },
  {
    key: "estimate",
    label: "Estimate",
    color: "bg-yellow-500",
    bgClass: "bg-yellow-50 dark:bg-yellow-950/30",
  },
  {
    key: "active",
    label: "Active",
    color: "bg-green-500",
    bgClass: "bg-green-950/10 dark:bg-green-950/30",
  },
  {
    key: "paused",
    label: "Paused",
    color: "bg-orange-500",
    bgClass: "bg-orange-50 dark:bg-orange-950/30",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    color: "bg-red-500",
    bgClass: "bg-red-50 dark:bg-red-950/30",
  },
];

function formatDuration(dateStr: string | Date): string {
  const then = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month";
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year" : `${years} years`;
}

function ContactCard({
  contact,
  onDragStart,
}: {
  contact: Contact;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, contact.id)}
      className="cursor-grab active:cursor-grabbing"
      data-testid={`pipeline-card-${contact.id}`}
    >
      <Link href={`/contacts/${contact.id}`}>
        <Card
          className="hover-elevate transition-shadow"
          data-testid={`pipeline-card-link-${contact.id}`}
        >
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="font-medium text-sm truncate"
                  data-testid={`pipeline-name-${contact.id}`}
                >
                  {contact.firstName} {contact.lastName}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {contact.phone && (
                <span className="flex items-center gap-1 truncate">
                  <Phone className="h-3 w-3 flex-shrink-0" />
                  {contact.phone}
                </span>
              )}
              {contact.email && (
                <span className="flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 flex-shrink-0" />
                  {contact.email}
                </span>
              )}
              {(contact.numberOfDogs ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Dog className="h-3 w-3 flex-shrink-0" />
                  {contact.numberOfDogs} {contact.numberOfDogs === 1 ? "dog" : "dogs"}
                </span>
              )}
            </div>
            <p
              className="text-[11px] text-muted-foreground/70"
              data-testid={`pipeline-stage-duration-${contact.id}`}
            >
              In stage {formatDuration(contact.updatedAt)}
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

export default function Pipeline() {
  const { toast } = useToast();
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const draggedContactId = useRef<string | null>(null);

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/contacts/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const grouped = COLUMNS.reduce<Record<string, Contact[]>>((acc, col) => {
    acc[col.key] = [];
    return acc;
  }, {});

  if (contacts) {
    for (const contact of contacts) {
      if (grouped[contact.status]) {
        grouped[contact.status].push(contact);
      }
    }
  }

  const handleDragStart = useCallback((e: React.DragEvent, contactId: string) => {
    draggedContactId.current = contactId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", contactId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, newStatus: string) => {
      e.preventDefault();
      setDragOverColumn(null);
      const contactId = draggedContactId.current;
      if (!contactId) return;
      draggedContactId.current = null;

      const contact = contacts?.find((c) => c.id === contactId);
      if (!contact || contact.status === newStatus) return;

      updateStatusMutation.mutate({ id: contactId, status: newStatus });
    },
    [contacts, updateStatusMutation]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 md:p-6 pb-2 flex-shrink-0">
        <h1 className="text-2xl font-bold" data-testid="text-pipeline-heading">
          Pipeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="text-pipeline-subtitle">
          Drag contacts between stages to update their status
        </p>
      </div>

      {isLoading ? (
        <div className="flex-1 flex gap-4 p-4 pt-2 overflow-x-auto">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex-shrink-0 w-64">
              <Skeleton className="h-10 w-full mb-3 rounded-lg" />
              <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex-1 flex gap-3 p-4 pt-2 overflow-x-auto min-h-0"
          data-testid="pipeline-board"
        >
          {COLUMNS.map((col) => {
            const columnContacts = grouped[col.key] || [];
            const isOver = dragOverColumn === col.key;
            return (
              <div
                key={col.key}
                className="flex-shrink-0 w-64 flex flex-col min-h-0"
                data-testid={`pipeline-column-${col.key}`}
              >
                <div
                  className={`rounded-lg px-3 py-2 mb-2 flex items-center justify-between ${col.bgClass}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                    <span
                      className="text-sm font-medium"
                      data-testid={`pipeline-column-label-${col.key}`}
                    >
                      {col.label}
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="text-xs h-5 min-w-[20px] px-1.5"
                    data-testid={`pipeline-column-count-${col.key}`}
                  >
                    {columnContacts.length}
                  </Badge>
                </div>

                <div
                  className={`flex-1 overflow-y-auto space-y-2 p-1 rounded-lg transition-colors ${
                    isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""
                  }`}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.key)}
                  data-testid={`pipeline-dropzone-${col.key}`}
                >
                  {columnContacts.length === 0 ? (
                    <div
                      className="text-center py-8 text-sm text-muted-foreground/50"
                      data-testid={`pipeline-empty-${col.key}`}
                    >
                      No contacts
                    </div>
                  ) : (
                    columnContacts.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        onDragStart={handleDragStart}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
