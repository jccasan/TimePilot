import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Users } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PostOnboardingImportPromptProps {
  open: boolean;
  onDismiss: () => void;
}

export function PostOnboardingImportPrompt({ open, onDismiss }: PostOnboardingImportPromptProps) {
  const [, navigate] = useLocation();
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  async function handleImport() {
    setIsPending(true);
    try {
      await Promise.all([
        apiRequest("PATCH", "/api/auth/import-mode", { enabled: true }),
        apiRequest("PATCH", "/api/company", { clientNotificationsSuppressed: true }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      onDismiss();
      navigate("/migration");
    } catch {
      toast({
        title: "Something went wrong",
        description: "Could not enable import mode. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-post-onboarding-import">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Import your existing clients?
          </DialogTitle>
          <DialogDescription>
            If you are switching from another system, we can pull in your client list, service
            plans, pricing, and dog info automatically. Client notifications will stay off until you
            are ready to send them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-2">
          <Button
            onClick={handleImport}
            disabled={isPending}
            className="w-full"
            data-testid="button-start-import"
          >
            <Upload className="h-4 w-4 mr-2" />
            {isPending ? "Setting up..." : "Yes, import my clients"}
          </Button>
          <Button
            variant="ghost"
            onClick={onDismiss}
            disabled={isPending}
            className="w-full"
            data-testid="button-skip-import"
          >
            No thanks, I will add clients manually
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
