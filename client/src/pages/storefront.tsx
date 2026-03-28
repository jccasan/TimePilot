/**
 * Public Storefront Page
 *
 * URL: /store/:accountId
 *
 * NOTE: In production, replace the raw Stripe account ID (acct_xxx) in the
 * URL with a slug or opaque identifier to avoid exposing internal account IDs.
 * For example, store a slug in your database and resolve it to the account ID
 * server-side before making Stripe API calls.
 *
 * This page is intentionally unauthenticated — any visitor can browse and buy.
 */

import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingCart, ShoppingBag, CheckCircle } from "lucide-react";

type Product = {
  productId: string;
  name: string;
  description: string | null;
  priceId: string | null;
  priceCents: number | null;
  currency: string | null;
};

function formatCents(cents: number | null, currency: string | null): string {
  if (cents === null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency?.toUpperCase() ?? "USD",
  }).format(cents / 100);
}

export function StorefrontPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/connect/v2/storefront", accountId, "products"],
    queryFn: async () => {
      const res = await fetch(`/api/connect/v2/storefront/${accountId}/products`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!accountId,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (product: Product) => {
      if (!product.priceId) {
        throw new Error("This product does not have a price configured.");
      }
      // Note: priceCents is NOT sent to the server. The server retrieves the
      // authoritative price from Stripe to compute the application fee, preventing
      // fee tampering. priceCents here is display-only (shown in the UI).
      const res = await fetch(`/api/connect/v2/storefront/${accountId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: product.priceId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      return res.json() as Promise<{ url: string; sessionId: string }>;
    },
    onSuccess: (data) => {
      // Redirect to the Stripe Checkout page.
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: "Checkout Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold" data-testid="text-storefront-heading">
            Storefront
          </h1>
          <p className="text-muted-foreground" data-testid="text-storefront-account-id">
            Powered by Connect Account:{" "}
            <span className="font-mono text-xs">{accountId}</span>
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : products && products.length > 0 ? (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
            data-testid="storefront-products-grid"
          >
            {products.map((p) => (
              <Card key={p.productId} data-testid={`card-product-${p.productId}`}>
                <CardHeader>
                  <CardTitle className="text-lg" data-testid={`text-storefront-product-name-${p.productId}`}>
                    {p.name}
                  </CardTitle>
                  {p.description && (
                    <CardDescription data-testid={`text-storefront-product-desc-${p.productId}`}>
                      {p.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <p
                    className="text-2xl font-bold"
                    data-testid={`text-storefront-product-price-${p.productId}`}
                  >
                    {formatCents(p.priceCents, p.currency)}
                  </p>
                  <Button
                    className="w-full"
                    data-testid={`button-buy-${p.productId}`}
                    onClick={() => checkoutMutation.mutate(p)}
                    disabled={checkoutMutation.isPending || !p.priceId}
                  >
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    {checkoutMutation.isPending ? "Processing..." : "Buy Now"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3"
            data-testid="storefront-empty"
          >
            <ShoppingBag className="h-12 w-12 opacity-30" />
            <p className="text-lg">No products available yet.</p>
            <p className="text-sm">Check back soon!</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Success page shown after a successful Checkout redirect. */
export function StorefrontSuccessPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-4 max-w-sm" data-testid="storefront-success">
        <div className="flex justify-center">
          <CheckCircle className="h-16 w-16 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold" data-testid="text-success-heading">
          Purchase Successful!
        </h1>
        <p className="text-muted-foreground">
          Thank you for your purchase. You will receive a confirmation shortly.
        </p>
        <a
          href={`/store/${accountId}`}
          className="inline-block mt-4 text-primary underline"
          data-testid="link-back-to-store"
        >
          Back to Store
        </a>
      </div>
    </div>
  );
}
