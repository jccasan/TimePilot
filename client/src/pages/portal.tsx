import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ExternalLink, FileText, CreditCard, Calendar } from "lucide-react";

const portalFeatures = [
  { icon: Calendar, title: "Service Schedule", description: "View upcoming and past service visits" },
  { icon: CreditCard, title: "Payment Management", description: "Update payment methods and view billing history" },
  { icon: FileText, title: "Invoice Downloads", description: "Access and download all invoices" },
];

export default function Portal() {
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
            The client portal gives your customers direct access to manage their account
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
        <CardContent className="p-4 text-center">
          <p className="text-muted-foreground" data-testid="text-portal-status">
            Portal access can be enabled per contact from the contact detail page. 
            Customers with portal access will receive a link to view their services, payments, and invoices.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
