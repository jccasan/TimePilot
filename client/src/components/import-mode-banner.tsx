import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { FileUp, X } from "lucide-react";

interface ImportModeBannerProps {
  onTurnOff: () => void;
}

export function ImportModeBanner({ onTurnOff }: ImportModeBannerProps) {
  const turnOffMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/auth/import-mode", { enabled: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      onTurnOff();
    },
  });

  return (
    <div
      className="flex items-center justify-between gap-2 px-4 py-2 bg-primary/10 border-b border-primary/20 text-sm"
      data-testid="banner-import-mode"
    >
      <div className="flex items-center gap-2 text-primary font-medium">
        <FileUp className="h-4 w-4 shrink-0" />
        <span>Import Mode — On</span>
        <span className="hidden sm:inline text-muted-foreground font-normal">
          · Upload contacts from a spreadsheet or screenshot
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => turnOffMutation.mutate()}
        disabled={turnOffMutation.isPending}
        data-testid="button-import-mode-turn-off"
      >
        <X className="h-3.5 w-3.5" />
        Turn off
      </Button>
    </div>
  );
}
