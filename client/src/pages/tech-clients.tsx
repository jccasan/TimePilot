import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { MapPin, Dog, Phone, Mail, Search, Calendar } from "lucide-react";

const statusColors: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  estimate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const dayLabels: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const frequencyLabels: Record<string, string> = {
  "1_per_week": "1x/wk",
  "2_per_week": "2x/wk",
  "biweekly": "Bi-weekly",
  "as_needed": "As needed",
  "weekly": "Weekly",
  "monthly": "Monthly",
};

export default function TechClients() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    const term = searchTerm.toLowerCase();
    return contacts.filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(term) ||
      c.streetAddress?.toLowerCase().includes(term) ||
      c.city?.toLowerCase().includes(term) ||
      c.phone?.includes(term)
    );
  }, [contacts, searchTerm]);

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      <h1 className="text-xl font-bold" data-testid="text-tech-clients-heading">Clients</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, address, or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
          data-testid="input-tech-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredContacts.length > 0 ? (
        <div className="space-y-2">
          {filteredContacts.map((contact) => (
            <Card key={contact.id} data-testid={`card-tech-client-${contact.id}`}>
              <CardContent className="p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <p className="font-medium text-sm" data-testid={`text-client-name-${contact.id}`}>
                    {contact.firstName} {contact.lastName}
                  </p>
                  <Badge className={`text-[10px] ${statusColors[contact.status] || ""}`} data-testid={`badge-client-status-${contact.id}`}>
                    {contact.status}
                  </Badge>
                </div>

                {contact.streetAddress && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {contact.streetAddress}
                      {contact.city ? `, ${contact.city}` : ""}
                      {contact.state ? ` ${contact.state}` : ""}
                      {contact.zipCode ? ` ${contact.zipCode}` : ""}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="flex items-center gap-1 hover:underline" data-testid={`link-client-phone-${contact.id}`}>
                      <Phone className="h-3 w-3" />
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="flex items-center gap-1 hover:underline" data-testid={`link-client-email-${contact.id}`}>
                      <Mail className="h-3 w-3" />
                      {contact.email}
                    </a>
                  )}
                  {contact.numberOfDogs != null && contact.numberOfDogs > 0 && (
                    <span className="flex items-center gap-1">
                      <Dog className="h-3 w-3" />
                      {contact.numberOfDogs} {contact.numberOfDogs === 1 ? "dog" : "dogs"}
                    </span>
                  )}
                  {contact.serviceDay && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {dayLabels[contact.serviceDay] || contact.serviceDay}
                    </span>
                  )}
                  {contact.serviceFrequency && (
                    <span>{frequencyLabels[contact.serviceFrequency] || contact.serviceFrequency}</span>
                  )}
                </div>

                {contact.notes && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2" data-testid={`text-client-notes-${contact.id}`}>
                    {contact.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-clients">
            {searchTerm ? "No clients matching your search" : "No clients found"}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
