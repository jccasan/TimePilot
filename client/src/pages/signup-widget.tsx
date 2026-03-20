import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Dog, Loader2 } from "lucide-react";

type CompanyInfo = {
  name: string;
  logoUrl: string | null;
};

type QuoteResult = {
  contactId: string;
  quote: {
    recommendedPriceCents: number;
    frequency: string;
  };
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every Other Week",
  monthly: "Monthly",
  onetime: "One-Time",
};

const DAY_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export default function SignupWidget() {
  const [, params] = useRoute("/signup/:slug");
  const slug = params?.slug || "";

  const { data: company, isLoading, error } = useQuery<CompanyInfo>({
    queryKey: ["/api/public/company", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/company/${slug}`);
      if (!res.ok) throw new Error("Company not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    numberOfDogs: "1",
    serviceFrequency: "weekly",
    serviceDay: "",
  });

  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/leads/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          numberOfDogs: parseInt(formData.numberOfDogs, 10) || 1,
          serviceDay: formData.serviceDay || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
      return res.json() as Promise<QuoteResult>;
    },
    onSuccess: (data) => {
      setQuoteResult(data);
    },
  });

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 text-center">
            <Dog className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-company-not-found">Company Not Found</h2>
            <p className="text-muted-foreground">This signup page is not available. Please check the link and try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quoteResult) {
    const priceDollars = (quoteResult.quote.recommendedPriceCents / 100).toFixed(2);
    const freqLabel = FREQUENCY_LABELS[quoteResult.quote.frequency] || quoteResult.quote.frequency;
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <div className="bg-green-700 p-6 text-center rounded-t-lg">
            {company.logoUrl && (
              <img src={company.logoUrl} alt={company.name} className="h-12 mx-auto mb-3 rounded" data-testid="img-company-logo" />
            )}
            <h1 className="text-xl font-bold text-white" data-testid="text-company-name">{company.name}</h1>
          </div>
          <CardContent className="p-8 text-center space-y-6">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2" data-testid="text-quote-title">Your Estimated Quote</h2>
              <div className="text-4xl font-bold text-green-700 mb-1" data-testid="text-quote-price">
                ${priceDollars}
              </div>
              <p className="text-muted-foreground" data-testid="text-quote-frequency">per {freqLabel.toLowerCase()} visit</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
              <p>Thank you, {formData.firstName}! Your information has been submitted.</p>
              <p>A representative from <strong>{company.name}</strong> will reach out to you shortly to confirm your service and schedule.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFormValid = formData.firstName.trim().length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <div className="bg-green-700 p-6 text-center rounded-t-lg">
          {company.logoUrl && (
            <img src={company.logoUrl} alt={company.name} className="h-12 mx-auto mb-3 rounded" data-testid="img-company-logo" />
          )}
          <h1 className="text-xl font-bold text-white" data-testid="text-company-name">{company.name}</h1>
          <p className="text-green-100 text-sm mt-1">Get a free quote for pet waste removal</p>
        </div>
        <CardContent className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isFormValid) submitMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  data-testid="input-last-name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  data-testid="input-phone"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="streetAddress">Street Address</Label>
              <Input
                id="streetAddress"
                value={formData.streetAddress}
                onChange={(e) => updateField("streetAddress", e.target.value)}
                data-testid="input-street-address"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => updateField("city", e.target.value)}
                  data-testid="input-city"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e) => updateField("state", e.target.value)}
                  maxLength={2}
                  data-testid="input-state"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zipCode">ZIP Code</Label>
                <Input
                  id="zipCode"
                  value={formData.zipCode}
                  onChange={(e) => updateField("zipCode", e.target.value)}
                  data-testid="input-zip-code"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="numberOfDogs">Number of Dogs</Label>
                <Select value={formData.numberOfDogs} onValueChange={(v) => updateField("numberOfDogs", v)}>
                  <SelectTrigger data-testid="select-number-of-dogs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "dog" : "dogs"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serviceFrequency">Service Frequency</Label>
                <Select value={formData.serviceFrequency} onValueChange={(v) => updateField("serviceFrequency", v)}>
                  <SelectTrigger data-testid="select-service-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="serviceDay">Preferred Service Day</Label>
              <Select value={formData.serviceDay} onValueChange={(v) => updateField("serviceDay", v)}>
                <SelectTrigger data-testid="select-service-day">
                  <SelectValue placeholder="No preference" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {submitMutation.isError && (
              <p className="text-sm text-destructive" data-testid="text-submit-error">
                {(submitMutation.error as Error).message || "Something went wrong. Please try again."}
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-green-700 hover:bg-green-800"
              disabled={!isFormValid || submitMutation.isPending}
              data-testid="button-get-quote"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Get My Free Quote"
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              By submitting, you agree to be contacted by {company.name} about their services.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
