import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, DollarSign, Dog, Calendar, GripVertical, Users } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { Link } from "wouter";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayLabels: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};
const dayFullLabels: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
const UNASSIGNED = "__unassigned__";

const frequencyLabels: Record<string, string> = {
  "1_per_week": "1x/wk",
  "2_per_week": "2x/wk",
  "biweekly": "Bi-wkly",
  "as_needed": "As needed",
  "weekly": "Weekly",
  "monthly": "Monthly",
};

const yardSizeLabels: Record<string, string> = {
  "0.25_or_less": "< 0.25 ac",
  "0.26_0.5": "0.26-0.5 ac",
  "0.51_0.75": "0.51-0.75 ac",
  "0.75_1": "0.75-1 ac",
  "over_1": "> 1 ac",
};

const leadSourceLabels: Record<string, string> = {
  referral: "Referral", facebook: "Facebook", google: "Google", bing: "Bing",
  nextdoor: "NextDoor", yard_sign: "Yard Sign", local_advertising: "Local Ad",
};

const statusColors: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  estimate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function DraggableContactCard({ contact }: { contact: Contact }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: contact.id,
    data: { contact },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const pricePerVisit = contact.serviceFrequency === "2_per_week" ? "x2" : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-md p-3 bg-background transition-opacity space-y-1.5 ${isDragging ? "opacity-30" : ""}`}
      data-testid={`draggable-contact-${contact.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="cursor-grab active:cursor-grabbing touch-none pt-0.5" {...listeners} {...attributes}>
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <Link href={`/contacts/${contact.id}`}>
              <span className="font-medium text-sm hover:underline cursor-pointer" data-testid={`text-route-contact-name-${contact.id}`}>
                {contact.firstName} {contact.lastName}
              </span>
            </Link>
            <Badge className={`text-[10px] ${statusColors[contact.status] || ""}`} data-testid={`badge-contact-status-${contact.id}`}>
              {contact.status}
            </Badge>
          </div>

          {contact.streetAddress && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate" data-testid={`text-route-address-${contact.id}`}>
                {contact.streetAddress}
                {contact.city ? `, ${contact.city}` : ""}
                {contact.state ? ` ${contact.state}` : ""}
                {contact.zipCode ? ` ${contact.zipCode}` : ""}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {contact.numberOfDogs != null && contact.numberOfDogs > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-route-dogs-${contact.id}`}>
                <Dog className="h-3 w-3" />
                <span>{contact.numberOfDogs} {contact.numberOfDogs === 1 ? "dog" : "dogs"}</span>
              </div>
            )}
            {contact.serviceFrequency && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-route-frequency-${contact.id}`}>
                <Calendar className="h-3 w-3" />
                <span>{frequencyLabels[contact.serviceFrequency] || contact.serviceFrequency}</span>
              </div>
            )}
            {contact.yardSize && (
              <span className="text-xs text-muted-foreground" data-testid={`text-route-yard-${contact.id}`}>
                {yardSizeLabels[contact.yardSize] || contact.yardSize}
              </span>
            )}
            {contact.leadSource && (
              <span className="text-xs text-muted-foreground" data-testid={`text-route-source-${contact.id}`}>
                {leadSourceLabels[contact.leadSource] || contact.leadSource}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactCardOverlay({ contact }: { contact: Contact }) {
  return (
    <div className="border rounded-md p-3 bg-background shadow-lg opacity-90 max-w-xs space-y-1">
      <p className="font-medium text-sm">{contact.firstName} {contact.lastName}</p>
      {contact.streetAddress && (
        <p className="text-xs text-muted-foreground truncate">{contact.streetAddress}</p>
      )}
    </div>
  );
}

function DroppableDay({
  dayId,
  children,
  isOver,
}: {
  dayId: string;
  children: React.ReactNode;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: dayId });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[120px] rounded-md p-2 space-y-2 transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""}`}
      data-testid={`drop-zone-${dayId}`}
    >
      {children}
    </div>
  );
}

export default function RoutesPage() {
  const { toast } = useToast();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overContainerId, setOverContainerId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const updateDayMutation = useMutation({
    mutationFn: async ({ contactId, serviceDay }: { contactId: string; serviceDay: string | null }) => {
      await apiRequest("PATCH", `/api/contacts/${contactId}`, { serviceDay });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error moving client", description: error.message, variant: "destructive" });
    },
  });

  const contactsByDay = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    for (const d of daysOfWeek) map[d] = [];
    map[UNASSIGNED] = [];

    if (contacts) {
      for (const c of contacts) {
        if (c.serviceDay && map[c.serviceDay]) {
          map[c.serviceDay].push(c);
        } else {
          map[UNASSIGNED].push(c);
        }
      }
    }
    return map;
  }, [contacts]);

  const dayStats = useMemo(() => {
    const stats: Record<string, { count: number }> = {};
    for (const d of daysOfWeek) {
      stats[d] = { count: contactsByDay[d]?.length || 0 };
    }
    return stats;
  }, [contactsByDay]);

  const activeContact = useMemo(() => {
    if (!activeDragId || !contacts) return null;
    return contacts.find(c => c.id === activeDragId) || null;
  }, [activeDragId, contacts]);

  const resolveDay = useCallback((overId: string): string | null => {
    if (daysOfWeek.includes(overId) || overId === UNASSIGNED) return overId;
    if (!contacts) return null;
    const overContact = contacts.find(c => c.id === overId);
    if (overContact) return overContact.serviceDay || UNASSIGNED;
    return null;
  }, [contacts]);

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as string | null;
    if (overId) {
      const resolved = resolveDay(overId);
      setOverContainerId(resolved);
    } else {
      setOverContainerId(null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setOverContainerId(null);

    const { active, over } = event;
    if (!over) return;

    const contactId = active.id as string;
    const targetDay = resolveDay(over.id as string);
    if (!targetDay) return;

    const contact = contacts?.find(c => c.id === contactId);
    if (!contact) return;

    const currentDay = contact.serviceDay || UNASSIGNED;
    if (currentDay === targetDay) return;

    const newDay = targetDay === UNASSIGNED ? null : targetDay;
    updateDayMutation.mutate({ contactId, serviceDay: newDay });
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverContainerId(null);
  }

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-routes-heading">Routes</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{contacts?.length || 0} total clients</span>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
            {daysOfWeek.map((day) => {
              const dayContacts = contactsByDay[day] || [];
              const isOverThis = overContainerId === day;
              return (
                <Card key={day} data-testid={`card-day-${day}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm" data-testid={`text-day-label-${day}`}>{dayFullLabels[day]}</h3>
                      <Badge variant="secondary" data-testid={`badge-day-count-${day}`}>
                        {dayContacts.length}
                      </Badge>
                    </div>
                    <DroppableDay dayId={day} isOver={isOverThis}>
                      {dayContacts.length > 0 ? (
                        dayContacts.map((contact) => (
                          <DraggableContactCard key={contact.id} contact={contact} />
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          Drag clients here
                        </p>
                      )}
                    </DroppableDay>
                  </CardContent>
                </Card>
              );
            })}

            <Card data-testid="card-day-unassigned">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm" data-testid="text-day-label-unassigned">Unassigned</h3>
                  <Badge variant="secondary" data-testid="badge-day-count-unassigned">
                    {contactsByDay[UNASSIGNED]?.length || 0}
                  </Badge>
                </div>
                <DroppableDay dayId={UNASSIGNED} isOver={overContainerId === UNASSIGNED}>
                  {(contactsByDay[UNASSIGNED] || []).length > 0 ? (
                    (contactsByDay[UNASSIGNED] || []).map((contact) => (
                      <DraggableContactCard key={contact.id} contact={contact} />
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      All clients assigned
                    </p>
                  )}
                </DroppableDay>
              </CardContent>
            </Card>
          </div>

          <DragOverlay>
            {activeContact ? <ContactCardOverlay contact={activeContact} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
