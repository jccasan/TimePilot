import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mic, CheckCircle, Phone, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";

type VoiceSignupInfo = {
  companyName: string;
  isSubscriber: boolean;
  plans: Array<{
    key: string;
    name: string;
    price: number;
    subscriberPrice: number;
    regularPrice: number;
    includedMinutes: number;
    overageRate: number;
  }>;
  currentVoicePlan: string | null;
};

function extractSlugFromPath(): string {
  const match = window.location.pathname.match(/^\/voice-signup\/([^/?#]+)/);
  return match ? match[1] : "";
}

export default function VoiceSignup() {
  const slug = useMemo(() => extractSlugFromPath(), []);
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const isSuccess = urlParams.get("success") === "1";

  const { data: info, isLoading, error } = useQuery<VoiceSignupInfo>({
    queryKey: ["/api/voice-signup", slug, "info"],
    queryFn: async () => {
      const res = await fetch(`/api/voice-signup/${slug}/info`);
      if (!res.ok) throw new Error("Company not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await fetch(`/api/voice-signup/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, email }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Checkout failed");
      }
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isSuccess || success) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-green-950 dark:to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-600 mx-auto" />
            <h2 className="text-2xl font-bold">Voice Plan Activated</h2>
            <p className="text-muted-foreground">
              Your voice agent plan has been successfully activated. You can now configure your voice agent in your ScooPilot dashboard.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-96 w-96" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>Company not found. Please check the URL and try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (info.currentVoicePlan) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-green-950 dark:to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <Mic className="h-16 w-16 text-green-600 mx-auto" />
            <h2 className="text-2xl font-bold">Voice Plan Active</h2>
            <p className="text-muted-foreground">
              {info.companyName} already has an active voice plan. Manage it from your ScooPilot dashboard.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-green-950 dark:to-background">
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-8">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <img src={logoSquare} alt="ScooPilot" className="h-8 w-8 rounded" />
            <span className="text-lg font-semibold">ScooPilot</span>
          </div>
          <h1 className="text-3xl font-bold" data-testid="text-voice-signup-heading">
            Voice Agent for {info.companyName}
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Add an AI-powered voice agent to handle scheduling calls, appointment booking, and customer inquiries 24/7.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="voice-email">
            Your email address
          </label>
          <input
            id="voice-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full max-w-md mx-auto block px-4 py-2 border rounded-md bg-background"
            data-testid="input-voice-email"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {info.plans.map((plan) => (
            <Card key={plan.key} className="relative" data-testid={`card-public-voice-${plan.key}`}>
              {plan.key === "voice_pro" && (
                <Badge className="absolute -top-2.5 right-4 bg-green-600">Popular</Badge>
              )}
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <Mic className="h-5 w-5" />
                  {plan.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-3xl font-bold" data-testid={`text-public-voice-price-${plan.key}`}>
                    ${plan.price}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  {plan.price < plan.regularPrice && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      Subscriber discount applied
                    </p>
                  )}
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {plan.includedMinutes} minutes included/mo
                  </li>
                  <li className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    ${plan.overageRate.toFixed(2)}/min overage
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    24/7 AI scheduling
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Appointment booking
                  </li>
                </ul>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => checkoutMutation.mutate(plan.key)}
                  disabled={checkoutMutation.isPending || !email}
                  data-testid={`button-public-voice-checkout-${plan.key}`}
                >
                  {checkoutMutation.isPending ? "Processing..." : `Get ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Powered by ScooPilot. Secure payments by Stripe.
        </p>
      </div>
    </div>
  );
}
