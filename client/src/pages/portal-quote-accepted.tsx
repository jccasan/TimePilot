import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function PortalQuoteAccepted() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name") || "there";
  const company = params.get("company") || "your service provider";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="p-10">
          <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-5" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">You're on the schedule!</h2>
          <p className="text-muted-foreground mb-1">
            Thanks, {name}. {company} will be in touch shortly to confirm your first service date.
          </p>
          <p className="text-sm text-muted-foreground mt-4">
            You can reply to the quote email with any questions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
