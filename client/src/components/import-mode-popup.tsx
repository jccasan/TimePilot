import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileUp, History } from "lucide-react";

interface ImportModePopupProps {
  open: boolean;
  onClose: () => void;
}

export function ImportModePopup({ open, onClose }: ImportModePopupProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-import-mode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileUp className="h-5 w-5 text-primary" />
            Import Mode is On
          </DialogTitle>
          <DialogDescription className="text-base pt-1">
            Your workspace is ready to bring in your existing contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">While Import Mode is active you can:</p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-sm">
              <FileUp className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Upload a spreadsheet or screenshot to import contacts in bulk</span>
            </li>
            <li className="flex items-start gap-2 text-sm">
              <History className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Review your import history to see what was brought in</span>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            A banner at the top of the app will remind you that Import Mode is on. You can turn it
            off at any time by clicking "Turn off" in the banner.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose} data-testid="button-import-mode-popup-close">
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
