import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    if (standalone) return;

    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIos(iosDevice);

    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    if (iosDevice) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowPrompt(true), 2000);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem("pwa-install-dismissed", String(Date.now()));
  };

  if (isStandalone || !showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex justify-center" data-testid="container-pwa-install">
      <Card className="w-full max-w-md shadow-lg border">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 p-1.5 bg-primary/10 rounded-md">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              {isIos ? (
                <>
                  <p className="text-sm font-medium">Install ScooPilot</p>
                  <p className="text-xs text-muted-foreground">
                    Tap the <Share className="inline h-3 w-3 -mt-0.5" /> Share button in Safari, then scroll down and tap "Add to Home Screen"
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Install ScooPilot</p>
                  <p className="text-xs text-muted-foreground">
                    Add ScooPilot to your home screen for quick access
                  </p>
                  <Button
                    size="sm"
                    onClick={handleInstall}
                    data-testid="button-pwa-install"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Install App
                  </Button>
                </>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleDismiss}
              data-testid="button-pwa-dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
