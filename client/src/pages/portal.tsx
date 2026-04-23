import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, FileText, CreditCard, Calendar, Copy, CheckCircle, PauseCircle, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  hasPortalAccess: boolean;
  status: string;
};

const portalFeatures = [
  { icon: Calendar, title: "Service Schedule", description: "View upcoming and past service visits, pause or resume service" },
  { icon: CreditCard, title: "Online Payments", description: "Pay invoices directly through Stripe checkout" },
  { icon: FileText, title: "Invoice History", description: "Access and review all past and pending invoices" },
  { icon: PauseCircle, title: "Service Control", description: "Customers can pause and resume their own service" },
];

export default function Portal() {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const portalContacts = contacts?.filter((c) => c.hasPortalAccess) || [];
  const portalUrl = `${window.location.origin}/portal/login`;

  const copyLink = (contactEmail: string | null) => {
    const url = contactEmail ? `${portalUrl}?email=${encodeURIComponent(contactEmail)}` : portalUrl;
    navigator.clipboard.writeText(url);
    setCopiedId(contactEmail || "base");
    toast({ title: "Copied", description: "Portal link copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold" data-testid="text-portal-heading">Client Portal</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Customer Self-Service Portal
          </CardTitle>
          <CardDescription>
            Give your customers direct access to manage their account, view schedules, and pay invoices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {portalFeatures.map((feature) => (
            <div key={feature.title} className="flex items-start gap-3" data-testid={`text-portal-feature-${feature.title.toLowerCase().replace(/\s/g, "-")}`}>
              <feature.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{feature.title}</p>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Portal Link
          </CardTitle>
          <CardDescription>Share this link with customers who have portal access enabled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-md border bg-muted/50">
            <code className="text-sm flex-1 truncate" data-testid="text-portal-url">{portalUrl}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyLink(null)}
              data-testid="button-copy-portal-link"
            >
              {copiedId === "base" ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Customers log in with their email address and last name. Enable portal access from each contact's detail page.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Portal-Enabled Customers
            <Badge variant="secondary" data-testid="badge-portal-count">{portalContacts.length}</Badge>
          </CardTitle>
          <CardDescription>Contacts who currently have portal access</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : portalContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-portal-contacts">
              No contacts have portal access enabled yet. Go to a contact's detail page to turn it on.
            </p>
          ) : (
            <div className="space-y-2">
              {portalContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border flex-wrap"
                  data-testid={`card-portal-contact-${contact.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {contact.firstName} {contact.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{contact.email || "No email"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={contact.status === "active" ? "default" : "secondary"}>
                      {contact.status}
                    </Badge>
                    {contact.email && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyLink(contact.email)}
                        data-testid={`button-copy-link-${contact.id}`}
                      >
                        {copiedId === contact.email ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
