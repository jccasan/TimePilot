import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Dog, Phone, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayFullLabels: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

const frequencyLabels: Record<string, string> = {
  "1_per_week": "1x/wk",
  "2_per_week": "2x/wk",
  "biweekly": "Bi-weekly",
  "as_needed": "As needed",
  "weekly": "Weekly",
  "monthly": "Monthly",
};

type VisitStatus = "scheduled" | "completed" | "cancelled";

const visitStatusConfig: Record<VisitStatus, { label: string; color: string; icon: typeof Clock }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: Clock },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: XCircle },
};

function getTodayDayName(): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

function ContactRow({ contact, visitStatus, onStatusChange, isUpdating }: {
  contact: Contact;
  visitStatus: VisitStatus;
  onStatusChange: (contactId: string, status: VisitStatus) => void;
  isUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = visitStatusConfig[visitStatus];
  const StatusIcon = config.icon;

  return (
    <Card data-testid={`card-tech-contact-${contact.id}`}>
      <CardContent className="p-3 space-y-2">
        <div
          className="flex items-start justify-between gap-2 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-expand-${contact.id}`}
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm" data-testid={`text-tech-name-${contact.id}`}>
              {contact.firstName} {contact.lastName}
            </p>
            {contact.streetAddress && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate" data-testid={`text-tech-address-${contact.id}`}>
                  {contact.streetAddress}
                  {contact.city ? `, ${contact.city}` : ""}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`text-[10px] ${config.color}`} data-testid={`badge-tech-status-${contact.id}`}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {contact.numberOfDogs != null && contact.numberOfDogs > 0 && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Dog className="h-3 w-3" />
                  <span>{contact.numberOfDogs} {contact.numberOfDogs === 1 ? "dog" : "dogs"}</span>
                </div>
              )}
              {contact.serviceFrequency && (
                <div className="text-muted-foreground">
                  {frequencyLabels[contact.serviceFrequency] || contact.serviceFrequency}
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                  <Phone className="h-3 w-3" />
                  <a href={`tel:${contact.phone}`} className="hover:underline" data-testid={`link-tech-phone-${contact.id}`}>
                    {contact.phone}
                  </a>
                </div>
              )}
            </div>

            {contact.notes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Notes</p>
                <p className="text-xs" data-testid={`text-tech-notes-${contact.id}`}>{contact.notes}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {visitStatus !== "completed" && (
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(contact.id, "completed"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-complete-${contact.id}`}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  Complete
                </Button>
              )}
              {visitStatus !== "cancelled" && visitStatus !== "completed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(contact.id, "cancelled"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-cancel-${contact.id}`}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
              )}
              {visitStatus !== "scheduled" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(contact.id, "scheduled"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-scheduled-${contact.id}`}
                >
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getStorageKey(day: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `tech_visit_statuses_${day}_${today}`;
}

function loadStatuses(day: string): Record<string, VisitStatus> {
  try {
    const stored = localStorage.getItem(getStorageKey(day));
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStatuses(day: string, statuses: Record<string, VisitStatus>) {
  try {
    localStorage.setItem(getStorageKey(day), JSON.stringify(statuses));
  } catch {}
}

export default function TechRoutes() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState<string>(getTodayDayName());
  const [visitStatuses, setVisitStatuses] = useState<Record<string, Record<string, VisitStatus>>>(() => {
    const initial: Record<string, Record<string, VisitStatus>> = {};
    for (const day of daysOfWeek) {
      initial[day] = loadStatuses(day);
    }
    return initial;
  });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const dayContacts = useMemo(() => {
    if (!contacts) return [];
    return contacts.filter(c => c.serviceDay === selectedDay && c.status === "active");
  }, [contacts, selectedDay]);

  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (contacts) {
      for (const day of daysOfWeek) {
        counts[day] = contacts.filter(c => c.serviceDay === day && c.status === "active").length;
      }
    }
    return counts;
  }, [contacts]);

  const getVisitStatus = (contactId: string): VisitStatus => {
    return visitStatuses[selectedDay]?.[contactId] || "scheduled";
  };

  const handleStatusChange = (contactId: string, status: VisitStatus) => {
    setVisitStatuses(prev => {
      const dayStatuses = { ...prev[selectedDay], [contactId]: status };
      saveStatuses(selectedDay, dayStatuses);
      return { ...prev, [selectedDay]: dayStatuses };
    });
    toast({
      title: `Marked as ${visitStatusConfig[status].label.toLowerCase()}`,
    });
  };

  const completedCount = dayContacts.filter(c => getVisitStatus(c.id) === "completed").length;
  const totalCount = dayContacts.length;

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold" data-testid="text-tech-routes-heading">My Route</h1>
        {totalCount > 0 && (
          <span className="text-sm text-muted-foreground" data-testid="text-tech-progress">
            {completedCount}/{totalCount} completed
          </span>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {daysOfWeek.map((day) => {
          const isToday = day === getTodayDayName();
          const isSelected = day === selectedDay;
          return (
            <Button
              key={day}
              size="sm"
              variant={isSelected ? "default" : "outline"}
              onClick={() => setSelectedDay(day)}
              className="shrink-0 relative"
              data-testid={`button-tech-day-${day}`}
            >
              {dayFullLabels[day].slice(0, 3)}
              {(dayCounts[day] || 0) > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 text-[10px] px-1.5 py-0"
                >
                  {dayCounts[day]}
                </Badge>
              )}
              {isToday && !isSelected && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : dayContacts.length > 0 ? (
        <div className="space-y-2">
          {dayContacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              visitStatus={getVisitStatus(contact.id)}
              onStatusChange={handleStatusChange}
              isUpdating={updatingId === contact.id}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-tech-no-contacts">
            No clients scheduled for {dayFullLabels[selectedDay]}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
