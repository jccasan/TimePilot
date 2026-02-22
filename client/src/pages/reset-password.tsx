import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, ArrowLeft } from "lucide-react";
import logoLong from "@assets/ScooPilot_Long_text_1771089502024.png";

export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Password reset failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    resetMutation.mutate();
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-card">
        <div className="w-full max-w-md space-y-6 text-center">
          <img src={logoLong} alt="ScooPilot" className="w-full max-w-sm h-auto rounded-md mx-auto" />
          <Card>
            <CardContent className="p-6 space-y-4">
              <p className="text-muted-foreground">Invalid or missing reset link. Please request a new password reset from the sign in page.</p>
              <Button asChild className="w-full">
                <a href="/login" data-testid="link-back-to-login">
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back to Sign In
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-card">
        <div className="w-full max-w-md space-y-6 text-center">
          <img src={logoLong} alt="ScooPilot" className="w-full max-w-sm h-auto rounded-md mx-auto" />
          <Card>
            <CardContent className="p-6 space-y-4">
              <CheckCircle className="h-12 w-12 text-primary mx-auto" />
              <h2 className="text-xl font-semibold" data-testid="text-reset-success">Password Reset Successful</h2>
              <p className="text-muted-foreground">Your password has been updated. You can now sign in with your new password.</p>
              <Button asChild className="w-full">
                <a href="/login" data-testid="link-sign-in-after-reset">Sign In</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-card">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-start gap-4">
          <img src={logoLong} alt="ScooPilot" className="w-full max-w-sm h-auto rounded-md" />
        </div>
        <h2 className="text-xl font-semibold" data-testid="text-reset-heading">Set New Password</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              minLength={8}
              data-testid="input-confirm-password"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={resetMutation.isPending} data-testid="button-reset-password">
            {resetMutation.isPending ? "Resetting..." : "Reset Password"}
          </Button>
        </form>
        <div className="text-center">
          <a href="/login" className="text-sm text-muted-foreground hover:underline" data-testid="link-back-to-sign-in">
            Back to Sign In
          </a>
        </div>
      </div>
    </div>
  );
}
