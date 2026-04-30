import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Clock, ExternalLink, CheckCircle2, Globe, Linkedin } from "lucide-react";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";

export default function PendingApproval() {
  const { logout, isLoggingOut } = useAuth();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/submit-verification-url", { url });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit URL");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "Profile submitted",
        description: "We'll review your information and follow up by email.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    submitMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img
            src={logoSquare}
            alt="ScooPilot"
            className="h-12 w-12 rounded-xl object-cover"
            data-testid="img-pending-logo"
          />
          <h1 className="text-xl font-bold">ScooPilot</h1>
        </div>

        <Card data-testid="card-pending-approval">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded-full">
                <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-lg" data-testid="text-pending-title">
                  Account Under Review
                </CardTitle>
                <CardDescription className="text-xs">
                  Usually approved within 1 business day
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Because your account is registering from outside the United States or Canada, our team
              does a brief review before activating access. You'll receive an email with your login
              credentials once approved.
            </p>

            {!submitted ? (
              <form
                onSubmit={handleSubmit}
                className="space-y-3"
                data-testid="form-verification-url"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="verificationUrl" className="text-sm font-medium">
                    Speed up your approval
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Share your LinkedIn profile or business website so our team can verify your
                    account faster.
                  </p>
                  <div className="flex gap-2 items-center">
                    <div className="flex gap-1 text-muted-foreground">
                      <Linkedin className="h-4 w-4" />
                      <Globe className="h-4 w-4" />
                    </div>
                    <Input
                      id="verificationUrl"
                      type="url"
                      placeholder="https://linkedin.com/in/yourname or https://yourbusiness.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="flex-1 text-sm"
                      data-testid="input-verification-url"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitMutation.isPending || !url.trim()}
                  data-testid="button-submit-verification-url"
                >
                  {submitMutation.isPending ? "Submitting..." : "Submit for Faster Review"}
                </Button>
              </form>
            ) : (
              <div
                className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3"
                data-testid="status-url-submitted"
              >
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Profile submitted!
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                    Our team will review your information and send you an email once your account is
                    approved.
                  </p>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300 underline mt-1"
                      data-testid="link-submitted-url"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {url.length > 50 ? url.slice(0, 50) + "…" : url}
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground text-center">
                Questions? Email{" "}
                <a href="mailto:support@scoopilot.com" className="underline hover:text-foreground">
                  support@scoopilot.com
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            disabled={isLoggingOut}
            className="text-muted-foreground text-xs"
            data-testid="button-pending-logout"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
