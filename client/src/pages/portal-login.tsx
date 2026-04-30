/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn, ArrowLeft, Mail } from "lucide-react";

export default function PortalLogin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Required",
        description: "Please enter your email and password.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }

      const data = await res.json();
      sessionStorage.setItem("portalToken", data.token);
      sessionStorage.setItem("portalContactId", data.contactId);
      navigate("/portal/client");
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) {
      toast({
        title: "Required",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setForgotLoading(true);
    try {
      const res = await fetch("/api/portal/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Request failed");
      }

      setForgotSent(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  };

  if (showForgotPassword) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl" data-testid="text-forgot-password-title">
              {forgotSent ? "Check Your Email" : "Forgot Password"}
            </CardTitle>
            <CardDescription>
              {forgotSent
                ? `If an account exists for ${forgotEmail}, we've sent a password reset link. Check your inbox and spam folder.`
                : "Enter your email address and we'll send you a link to reset your password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forgotSent ? (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <Mail className="h-12 w-12 text-muted-foreground" />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotSent(false);
                    setForgotEmail("");
                  }}
                  data-testid="button-back-to-login-from-forgot"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgotEmail">Email Address</Label>
                  <Input
                    id="forgotEmail"
                    type="email"
                    placeholder="your@email.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    data-testid="input-forgot-email"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={forgotLoading}
                  data-testid="button-send-reset-link"
                >
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-primary underline"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotEmail("");
                    }}
                    data-testid="link-back-to-login"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl" data-testid="text-portal-login-title">
            Client Portal
          </CardTitle>
          <CardDescription>
            Sign in to view your service schedule, invoices, and manage your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-portal-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-portal-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-portal-login"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline font-medium"
                onClick={() => setShowForgotPassword(true)}
                data-testid="link-forgot-password"
              >
                Forgot Password?
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
