import { ClipboardList, Calendar, MapPin, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import logoLong from "@assets/ScooPilot_Long_text_1771089502024.png";

const features = [
  { icon: ClipboardList, title: "CRM", description: "Manage contacts and leads" },
  { icon: Calendar, title: "Scheduling", description: "Automate service scheduling" },
  { icon: MapPin, title: "Route Management", description: "Optimize daily routes" },
  { icon: FileText, title: "Invoicing", description: "Automated billing and payments" },
  { icon: ExternalLink, title: "Client Portal", description: "Self-service for customers" },
];

export default function AuthPage() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 bg-card">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-start gap-4">
            <img src={logoLong} alt="ScooPilot - Modern Solutions for Pet Waste Pros" className="w-full max-w-sm h-auto rounded-md" data-testid="img-brand-logo" />
            <h1 className="sr-only" data-testid="text-brand-title">ScooPilot</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Professional Pet Waste Removal Management
          </p>
          <Button asChild size="lg" data-testid="button-login">
            <a href="/api/login">Sign in</a>
          </Button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 bg-muted">
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-2xl font-semibold" data-testid="text-features-heading">
            Everything you need to run your business
          </h2>
          <div className="space-y-3">
            {features.map((feature) => (
              <Card key={feature.title}>
                <CardContent className="flex items-center gap-4 p-4">
                  <feature.icon className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium" data-testid={`text-feature-${feature.title.toLowerCase()}`}>
                      {feature.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
