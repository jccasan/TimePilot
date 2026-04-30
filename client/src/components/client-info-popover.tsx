import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Contact, Property, ServicePlan } from "@shared/schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  User,
  MapPin,
  Phone,
  Mail,
  Dog,
  DollarSign,
  Calendar,
  ExternalLink,
  Home,
} from "lucide-react";

const statusColors: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  estimate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const freqLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  onetime: "One-Time",
};

const dayLabels: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
  tbd: "TBD",
};

interface ClientInfoPopoverProps {
  contactId: string;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

function PopoverBody({ contactId }: { contactId: string }) {
  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", contactId],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: plans } = useQuery<ServicePlan[]>({
    queryKey: ["/api/service-plans"],
  });

  if (contactLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }

  if (!contact) {
    return <p className="text-sm text-muted-foreground">Contact not found</p>;
  }

  const contactProps = properties?.filter((p) => p.contactId === contactId) || [];
  const contactPlans = plans?.filter((p) => p.contactId === contactId && p.isActive) || [];
  const totalMonthly = contactPlans.reduce((sum, p) => {
    const price = Number(p.pricePerVisit);
    if (p.frequency === "weekly") return sum + price * 4.33;
    if (p.frequency === "biweekly") return sum + price * 2.17;
    if (p.frequency === "monthly") return sum + price;
    return sum;
  }, 0);

  return (
    <div className="space-y-3" data-testid={`client-popover-${contactId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" data-testid="client-popover-name">
            {contact.firstName} {contact.lastName}
          </p>
          <Badge
            variant="secondary"
            className={`text-[10px] mt-0.5 ${statusColors[contact.status] || ""}`}
          >
            {contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
          </Badge>
        </div>
        <Link href={`/contacts/${contactId}`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            data-testid="client-popover-view-profile"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      <div className="space-y-1.5 text-xs">
        {contact.email && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{contact.email}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="h-3 w-3 shrink-0" />
            <span>{contact.phone}</span>
          </div>
        )}
        {contact.streetAddress && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {contact.streetAddress}
              {contact.city ? `, ${contact.city}` : ""}
            </span>
          </div>
        )}
        {contact.numberOfDogs != null && contact.numberOfDogs > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Dog className="h-3 w-3 shrink-0" />
            <span>
              {contact.numberOfDogs} dog{contact.numberOfDogs > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {contactProps.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Properties ({contactProps.length})
            </p>
            <div className="space-y-1">
              {contactProps.slice(0, 3).map((prop) => (
                <div
                  key={prop.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Home className="h-3 w-3 shrink-0" />
                  <span className="truncate">{prop.streetAddress}</span>
                  {prop.numberOfDogs != null && prop.numberOfDogs > 0 && (
                    <span className="shrink-0 flex items-center gap-0.5">
                      <Dog className="h-2.5 w-2.5" />
                      {prop.numberOfDogs}
                    </span>
                  )}
                </div>
              ))}
              {contactProps.length > 3 && (
                <p className="text-[10px] text-muted-foreground">+{contactProps.length - 3} more</p>
              )}
            </div>
          </div>
        </>
      )}

      {contactPlans.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Jobs ({contactPlans.length})
            </p>
            <div className="space-y-1.5">
              {contactPlans.slice(0, 3).map((plan) => {
                const prop = properties?.find((p) => p.id === plan.propertyId);
                return (
                  <div key={plan.id} className="text-xs space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-muted-foreground truncate">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {freqLabels[plan.frequency] || plan.frequency}
                        {plan.dayOfWeek && plan.dayOfWeek !== "tbd" && (
                          <span>({dayLabels[plan.dayOfWeek] || plan.dayOfWeek})</span>
                        )}
                      </span>
                      <span className="font-medium shrink-0">
                        ${(Number(plan.pricePerVisit) || 0).toFixed(2)}
                      </span>
                    </div>
                    {prop && (
                      <p className="text-[10px] text-muted-foreground truncate pl-4">
                        {prop.streetAddress}
                      </p>
                    )}
                  </div>
                );
              })}
              {contactPlans.length > 3 && (
                <p className="text-[10px] text-muted-foreground">+{contactPlans.length - 3} more</p>
              )}
            </div>
          </div>
        </>
      )}

      {totalMonthly > 0 && (
        <>
          <Separator />
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="h-3 w-3" /> Est. Monthly
            </span>
            <span className="font-semibold text-primary">${totalMonthly.toFixed(2)}</span>
          </div>
        </>
      )}

      <Link href={`/contacts/${contactId}`} className="block">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs mt-1"
          data-testid="client-popover-full-profile"
        >
          <User className="h-3 w-3 mr-1" /> View Full Profile
        </Button>
      </Link>
    </div>
  );
}

export function ClientInfoPopover({
  contactId,
  children,
  className,
  side = "bottom",
  align = "start",
}: ClientInfoPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`text-left cursor-pointer hover:text-primary hover:underline underline-offset-2 transition-colors ${className || ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          data-testid={`client-info-trigger-${contactId}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        {open && <PopoverBody contactId={contactId} />}
      </PopoverContent>
    </Popover>
  );
}
