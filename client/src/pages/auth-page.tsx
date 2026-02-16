import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Calendar, MapPin, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import logoLong from "@assets/ScooPilot_Long_text_1771089502024.png";

const features = [
  { icon: ClipboardList, title: "CRM", description: "Manage contacts and leads" },
  { icon: Calendar, title: "Scheduling", description: "Automate service scheduling" },
  { icon: MapPin, title: "Route Management", description: "Optimize daily routes" },
  { icon: FileText, title: "Invoicing", description: "Automated billing and payments" },
  { icon: ExternalLink, title: "Client Portal", description: "Self-service for customers" },
];

export default function AuthPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
    },
    onError: (error: Error) => {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
    },
    onError: (error: Error) => {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) {
      registerMutation.mutate();
    } else {
      loginMutation.mutate();
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

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

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                data-testid="input-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? "At least 8 characters" : "Your password"}
                required
                minLength={isRegister ? 8 : undefined}
                data-testid="input-password"
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={isPending} data-testid="button-submit-auth">
              {isPending ? (isRegister ? "Creating account..." : "Signing in...") : (isRegister ? "Create Account" : "Sign In")}
            </Button>
          </form>

          <div className="text-center">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:underline"
              onClick={() => setIsRegister(!isRegister)}
              data-testid="button-toggle-auth-mode"
            >
              {isRegister ? "Already have an account? Sign in" : "Need an account? Create one"}
            </button>
          </div>
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
