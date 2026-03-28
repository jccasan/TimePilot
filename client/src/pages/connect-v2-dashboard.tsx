import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink, Plus, ShoppingBag, CheckCircle, AlertCircle, Store,
} from "lucide-react";

type AccountStatus = {
  cardPaymentsStatus: string;
  requirementsSummary: string;
  displayName: string;
  email: string | null;
};

type AccountData = {
  exists: boolean;
  accountId?: string;
  record?: {
    id: string;
    subscriptionStatus: string;
    stripeSubscriptionId: string | null;
  };
  status?: AccountStatus;
};

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
  const amt = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency?.toUpperCase() ?? "USD",
  }).format(amt);
}

export default function ConnectV2Dashboard() {
  const { toast } = useToast();

  const [createForm, setCreateForm] = useState({
    displayName: "",
    contactEmail: "",
    country: "US",
  });

  const [productForm, setProductForm] = useState({
    name: "",
    description: "",
    priceCents: "",
    currency: "usd",
  });

  const { data: account, isLoading: accountLoading } = useQuery<AccountData>({
    queryKey: ["/api/connect/v2/account"],
  });

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/connect/v2/products"],
    enabled: account?.exists === true,
  });

  const createAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect/v2/account", createForm);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Connected account created!" });
      queryClient.invalidateQueries({ queryKey: ["/api/connect/v2/account"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect/v2/account/onboard", {});
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect/v2/products", {
        ...productForm,
        priceCents: parseInt(productForm.priceCents, 10),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Product created!" });
      setProductForm({ name: "", description: "", priceCents: "", currency: "usd" });
      queryClient.invalidateQueries({ queryKey: ["/api/connect/v2/products"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const subscribeCheckoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect/v2/subscription/checkout", {});
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_self");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const managePortalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect/v2/subscription/portal", {});
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isActive = account?.status?.cardPaymentsStatus === "active";
  const subscriptionStatus = account?.record?.subscriptionStatus ?? "none";

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-connect-v2-heading">
          Stripe Connect V2 Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your connected account, products, and storefront.
        </p>
      </div>

      {/* ── Account Section ── */}
      {accountLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !account?.exists ? (
        <Card data-testid="card-create-account">
          <CardHeader>
            <CardTitle>Create Connected Account</CardTitle>
            <CardDescription>
              Set up a Stripe Connect V2 account to start accepting payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="displayName">Business Name</Label>
                <Input
                  id="displayName"
                  data-testid="input-display-name"
                  value={createForm.displayName}
                  onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  data-testid="input-contact-email"
                  value={createForm.contactEmail}
                  onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })}
                  placeholder="owner@example.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="country">Country (ISO 2-letter)</Label>
                <Input
                  id="country"
                  data-testid="input-country"
                  value={createForm.country}
                  onChange={(e) => setCreateForm({ ...createForm, country: e.target.value.toUpperCase() })}
                  placeholder="US"
                  maxLength={2}
                />
              </div>
            </div>
            <Button
              data-testid="button-create-account"
              onClick={() => createAccountMutation.mutate()}
              disabled={createAccountMutation.isPending || !createForm.displayName || !createForm.contactEmail}
            >
              {createAccountMutation.isPending ? "Creating..." : "Create Account"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-account-status">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Connected Account</CardTitle>
              <Badge
                variant={isActive ? "default" : "secondary"}
                data-testid="badge-card-payments-status"
              >
                {isActive ? (
                  <><CheckCircle className="h-3 w-3 mr-1" /> Payments Active</>
                ) : (
                  <><AlertCircle className="h-3 w-3 mr-1" /> Pending Onboarding</>
                )}
              </Badge>
            </div>
            <CardDescription>
              Account ID: <span className="font-mono text-xs" data-testid="text-account-id">{account.accountId}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Display Name: </span>
                <span data-testid="text-display-name">{account.status?.displayName || "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Requirements: </span>
                <span data-testid="text-requirements">{account.status?.requirementsSummary || "none"}</span>
              </p>
            </div>

            {!isActive && (
              <Button
                data-testid="button-onboard"
                onClick={() => onboardMutation.mutate()}
                disabled={onboardMutation.isPending}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                {onboardMutation.isPending ? "Generating link..." : "Onboard to Collect Payments"}
              </Button>
            )}

            {account.accountId && (
              <div className="mt-2 pt-2 border-t">
                <a
                  href={`/store/${account.accountId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline"
                  data-testid="link-storefront"
                >
                  <Store className="h-4 w-4" />
                  View Public Storefront
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Products Section ── */}
      {account?.exists && (
        <Card data-testid="card-products">
          <CardHeader>
            <CardTitle>Products</CardTitle>
            <CardDescription>Create products that customers can purchase from your storefront.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="productName">Product Name</Label>
                <Input
                  id="productName"
                  data-testid="input-product-name"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="Premium Service"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="productDescription">Description</Label>
                <Input
                  id="productDescription"
                  data-testid="input-product-description"
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="priceCents">Price (in cents, e.g. 2999 = $29.99)</Label>
                <Input
                  id="priceCents"
                  type="number"
                  min="1"
                  data-testid="input-price-cents"
                  value={productForm.priceCents}
                  onChange={(e) => setProductForm({ ...productForm, priceCents: e.target.value })}
                  placeholder="2999"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  data-testid="input-currency"
                  value={productForm.currency}
                  onChange={(e) => setProductForm({ ...productForm, currency: e.target.value.toLowerCase() })}
                  placeholder="usd"
                  maxLength={3}
                />
              </div>
            </div>
            <Button
              data-testid="button-create-product"
              onClick={() => createProductMutation.mutate()}
              disabled={createProductMutation.isPending || !productForm.name || !productForm.priceCents}
            >
              <Plus className="h-4 w-4 mr-2" />
              {createProductMutation.isPending ? "Creating..." : "Add Product"}
            </Button>

            <Separator />

            {/* Product List */}
            {productsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : products && products.length > 0 ? (
              <ul className="space-y-2">
                {products.map((p) => (
                  <li
                    key={p.productId}
                    className="flex items-center justify-between border rounded-md p-3"
                    data-testid={`product-item-${p.productId}`}
                  >
                    <div>
                      <p className="font-medium text-sm" data-testid={`text-product-name-${p.productId}`}>{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      )}
                    </div>
                    <span className="text-sm font-semibold" data-testid={`text-product-price-${p.productId}`}>
                      {formatCents(p.priceCents, p.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                <ShoppingBag className="h-8 w-8 opacity-40" />
                <p className="text-sm">No products yet. Add one above.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Platform Subscription Section ── */}
      {account?.exists && (
        <Card data-testid="card-subscription">
          <CardHeader>
            <CardTitle>Platform Subscription</CardTitle>
            <CardDescription>Subscribe to access premium platform features.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge
                variant={subscriptionStatus === "active" ? "default" : "outline"}
                data-testid="badge-subscription-status"
              >
                {subscriptionStatus === "none" ? "Not subscribed" : subscriptionStatus}
              </Badge>
            </div>

            <div className="flex gap-2 flex-wrap">
              {subscriptionStatus !== "active" && (
                <Button
                  data-testid="button-subscribe"
                  onClick={() => subscribeCheckoutMutation.mutate()}
                  disabled={subscribeCheckoutMutation.isPending}
                >
                  {subscribeCheckoutMutation.isPending ? "Redirecting..." : "Subscribe to Platform Plan"}
                </Button>
              )}

              {subscriptionStatus !== "none" && (
                <Button
                  variant="outline"
                  data-testid="button-manage-subscription"
                  onClick={() => managePortalMutation.mutate()}
                  disabled={managePortalMutation.isPending}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {managePortalMutation.isPending ? "Opening..." : "Manage Subscription"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
