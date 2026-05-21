import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Phone, Loader2 } from "lucide-react";

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  let r = parseInt(match[1], 16) / 255;
  let g = parseInt(match[2], 16) / 255;
  let b = parseInt(match[3], 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function getBrandStyles(primaryColor: string | null) {
  const defaultColor = "#15803d";
  const color = primaryColor || defaultColor;
  const hsl = hexToHsl(color);
  if (!hsl)
    return {
      headerBg: defaultColor,
      lightBg: "#f0fdf4",
      lightBorder: "#bbf7d0",
      accentText: defaultColor,
      checkBg: "#dcfce7",
      checkIcon: "#16a34a",
      gradientFrom: "#f0fdf4",
    };
  const lighterBg = `hsl(${hsl.h}, ${Math.min(hsl.s + 10, 100)}%, 95%)`;
  const lightBorder = `hsl(${hsl.h}, ${Math.min(hsl.s + 5, 100)}%, 85%)`;
  const checkBg = `hsl(${hsl.h}, ${Math.min(hsl.s + 10, 100)}%, 92%)`;
  const checkIcon = `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(hsl.l + 5, 40)}%)`;
  return {
    headerBg: color,
    lightBg: lighterBg,
    lightBorder,
    accentText: color,
    checkBg,
    checkIcon,
    gradientFrom: lighterBg,
  };
}

type StoredResult = {
  firstName: string;
  priceCents: number;
  callForQuote: boolean;
  freqLabel: string;
  initialCleanupLow: number | null;
  initialCleanupHigh: number | null;
};

type CompanyPublic = {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
};

export default function SignupWidgetThankYou() {
  const slug = useMemo(
    () => window.location.pathname.match(/^\/signup\/([^/]+)\/thank-you/)?.[1] ?? "",
    []
  );

  const isEmbed = useMemo(
    () => new URLSearchParams(window.location.search).get("embed") === "true",
    []
  );

  const stored = useMemo<StoredResult | null>(() => {
    try {
      const raw = sessionStorage.getItem(`sq_result_${slug}`);
      return raw ? (JSON.parse(raw) as StoredResult) : null;
    } catch {
      return null;
    }
  }, [slug]);

  const { data: company, isLoading } = useQuery<CompanyPublic>({
    queryKey: [`/api/public/company/${slug}`],
    queryFn: async () => {
      const res = await fetch(`/api/public/company/${slug}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!slug,
    retry: false,
  });

  const brandStyles = useMemo(
    () => getBrandStyles(company?.primaryColor ?? null),
    [company?.primaryColor]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const priceDollars = stored && !stored.callForQuote ? (stored.priceCents / 100).toFixed(2) : null;
  const isCallForQuote = stored?.callForQuote ?? false;
  const companyName = company?.name ?? "";

  return (
    <div
      className={isEmbed ? "" : "min-h-screen flex items-center justify-center p-4"}
      style={
        isEmbed
          ? {}
          : { background: `linear-gradient(to bottom, ${brandStyles.gradientFrom}, white)` }
      }
    >
      <div className={`w-full ${isEmbed ? "" : "max-w-lg"}`}>
        <Card className={`overflow-hidden ${isEmbed ? "shadow-none border-0" : "shadow-xl"}`}>
          <div className="p-8 text-center" style={{ backgroundColor: brandStyles.headerBg }}>
            {company?.logoUrl && (
              <img
                src={company.logoUrl}
                alt={companyName}
                className="h-14 mx-auto mb-4 rounded-lg shadow-sm"
                data-testid="img-company-logo-thankyou"
              />
            )}
            <h1
              className="text-2xl font-bold text-white mb-1"
              data-testid="text-company-name-thankyou"
            >
              {companyName}
            </h1>
            <p className="text-white/80 text-sm">
              {isCallForQuote ? "Custom Quote Request" : "You're all set!"}
            </p>
          </div>

          <CardContent className="p-8 space-y-6">
            <div className="flex justify-center">
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: brandStyles.checkBg }}
              >
                {isCallForQuote ? (
                  <Phone className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                ) : (
                  <CheckCircle2 className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                )}
              </div>
            </div>

            {priceDollars && (
              <div className="text-center">
                <h2
                  className="text-lg font-semibold text-muted-foreground mb-1"
                  data-testid="text-thankyou-freq"
                >
                  {stored!.freqLabel} Cleanup Estimate
                </h2>
                <div
                  className="text-5xl font-bold mb-2"
                  style={{ color: brandStyles.accentText }}
                  data-testid="text-thankyou-price"
                >
                  ${priceDollars}
                </div>
                <p className="text-muted-foreground" data-testid="text-thankyou-per-visit">
                  per cleanup visit
                </p>
              </div>
            )}

            {isCallForQuote && (
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2" data-testid="text-thankyou-cfq-title">
                  We'll Get You a Custom Quote
                </h2>
                <p className="text-lg text-muted-foreground" data-testid="text-thankyou-cfq-sub">
                  A team member will contact you with personalized pricing.
                </p>
              </div>
            )}

            {stored?.initialCleanupLow != null &&
              stored?.initialCleanupHigh != null &&
              !isCallForQuote && (
                <div
                  className="rounded-xl p-4 text-center"
                  style={{
                    backgroundColor: brandStyles.lightBg,
                    border: `1px solid ${brandStyles.lightBorder}`,
                  }}
                  data-testid="card-initial-cleanup-thankyou"
                >
                  <p className="text-sm font-medium mb-1" style={{ color: brandStyles.accentText }}>
                    Initial Cleanup Estimate
                  </p>
                  <p className="text-lg font-bold">
                    ${(stored.initialCleanupLow / 100).toFixed(2)} &ndash; $
                    {(stored.initialCleanupHigh / 100).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Based on time since last cleanup
                  </p>
                </div>
              )}

            <div
              className="rounded-xl bg-muted/50 p-5 text-sm text-muted-foreground space-y-3"
              data-testid="card-thankyou-message"
            >
              {stored?.firstName ? (
                <p>
                  Thank you, <strong>{stored.firstName}</strong>! Your information has been
                  submitted.
                </p>
              ) : (
                <p>Thank you! Your information has been submitted.</p>
              )}
              {companyName && (
                <p>
                  A representative from <strong>{companyName}</strong> will reach out to you shortly
                  to confirm your service and schedule.
                </p>
              )}
              {!isCallForQuote && (
                <p className="text-xs italic">
                  * Exact pricing may vary based on property assessment. Sales tax may apply.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {!isEmbed && (
          <div className="mt-6 text-center space-y-1">
            <p
              className="text-xs text-muted-foreground font-medium"
              data-testid="text-powered-by-thankyou"
            >
              Powered by{" "}
              <a
                href="https://servicd.app"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
                style={{ color: brandStyles.accentText }}
              >
                Servicd
              </a>
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-copyright-thankyou">
              &copy; {new Date().getFullYear()} PetPilot LLC dba Servicd and ScooPilot
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
