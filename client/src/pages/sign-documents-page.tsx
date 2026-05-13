import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, FileText, PenLine, AlertCircle, ExternalLink, Download } from "lucide-react";
import SignaturePad from "signature_pad";
import type { DocumentTemplate, DocumentRequest, DocumentSignature } from "@shared/schema";

interface SigningData {
  request: DocumentRequest;
  contact: { firstName: string; lastName: string; email: string | null } | null;
  company: { name: string; logoUrl: string | null } | null;
  templates: DocumentTemplate[];
  signatures: DocumentSignature[];
}

export default function SignDocumentsPage() {
  const token = window.location.pathname.replace("/sign/", "").replace(/^\//, "");

  const { data, isLoading, error, refetch } = useQuery<SigningData>({
    queryKey: ["/api/public/sign", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/sign/${token}`);
      if (!res.ok) throw new Error("Failed to load signing request");
      return res.json();
    },
    enabled: !!token,
    retry: 1,
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [signerName, setSignerName] = useState("");
  const [nameEntered, setNameEntered] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-xl font-semibold">Signing Request Not Found</h2>
            <p className="text-muted-foreground text-center">
              This signing link is invalid or has expired. Please contact your service provider.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.request.status === "cancelled") {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Request Cancelled</h2>
            <p className="text-muted-foreground text-center">
              This document signing request has been cancelled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isComplete =
    data.request.status === "completed" ||
    (data.signatures.length > 0 &&
      data.templates
        .filter((t) => t.isRequired)
        .every((t) => data.signatures.some((s) => s.templateId === t.id)));

  if (isComplete) {
    const certUrl = data.request.certificateUrl;
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <CheckCircle className="h-12 w-12 text-green-600" />
            <h2 className="text-xl font-semibold text-green-700">Documents Signed</h2>
            <p className="text-muted-foreground text-center">
              All documents have been successfully signed. Thank you!
            </p>
            {certUrl && (
              <Button
                variant="outline"
                asChild
                data-testid="button-download-certificate"
                className="mt-2"
              >
                <a
                  href={`/api/public/sign/${token}/certificate`}
                  download="signed-document-certificate.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download your signed document
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const signedTemplateIds = new Set(data.signatures.map((s) => s.templateId));
  const unsignedTemplates = data.templates.filter(
    (t) => t.isActive && !signedTemplateIds.has(t.id)
  );

  if (!nameEntered) {
    return (
      <NameEntryScreen
        company={data.company}
        contact={data.contact}
        signerName={signerName}
        setSignerName={setSignerName}
        onContinue={() => setNameEntered(true)}
        templateCount={unsignedTemplates.length}
      />
    );
  }

  if (currentStep >= unsignedTemplates.length) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <CheckCircle className="h-12 w-12 text-green-600" />
            <h2 className="text-xl font-semibold text-green-700">All Documents Signed</h2>
            <p className="text-muted-foreground text-center">
              Thank you! All required documents have been signed successfully.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentTemplate = unsignedTemplates[currentStep];

  return (
    <DocumentSigningStep
      token={token}
      template={currentTemplate}
      signerName={signerName}
      company={data.company}
      stepIndex={currentStep}
      totalSteps={unsignedTemplates.length}
      onSigned={() => {
        if (currentStep + 1 >= unsignedTemplates.length) {
          refetch();
        } else {
          setCurrentStep((s) => s + 1);
        }
      }}
    />
  );
}

function NameEntryScreen({
  company,
  contact,
  signerName,
  setSignerName,
  onContinue,
  templateCount,
}: {
  company: { name: string; logoUrl: string | null } | null;
  contact: { firstName: string; lastName: string; email: string | null } | null;
  signerName: string;
  setSignerName: (name: string) => void;
  onContinue: () => void;
  templateCount: number;
}) {
  const defaultName = contact ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() : "";

  const handleContinue = () => {
    const name = signerName.trim() || defaultName;
    if (!name) return;
    setSignerName(name);
    onContinue();
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <PenLine className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Document Signing</CardTitle>
          {company && (
            <CardDescription className="text-base">
              {company.name} has sent you {templateCount} document{templateCount !== 1 ? "s" : ""}{" "}
              to sign.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="signer-name">Your full name</Label>
            <Input
              id="signer-name"
              data-testid="input-signer-name"
              placeholder={defaultName || "Enter your full name"}
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
            />
            <p className="text-xs text-muted-foreground">
              Your name will be used as your legal signature identifier.
            </p>
          </div>
          <Button
            className="w-full"
            data-testid="button-start-signing"
            disabled={!signerName.trim() && !defaultName}
            onClick={handleContinue}
          >
            Begin Signing
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentSigningStep({
  token,
  template,
  signerName,
  company,
  stepIndex,
  totalSteps,
  onSigned,
}: {
  token: string;
  template: DocumentTemplate;
  signerName: string;
  company: { name: string; logoUrl: string | null } | null;
  stepIndex: number;
  totalSteps: number;
  onSigned: () => void;
}) {
  const padRef = useRef<SignaturePad | null>(null);
  const [padReady, setPadReady] = useState(false);
  const [documentViewed, setDocumentViewed] = useState(false);

  const canvasCallback = useCallback((node: HTMLCanvasElement | null) => {
    if (!node) return;
    padRef.current = new SignaturePad(node, {
      backgroundColor: "rgb(255, 255, 255)",
      penColor: "rgb(0, 0, 0)",
    });
    setPadReady(true);

    const resizeObserver = new ResizeObserver(() => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      node.width = node.offsetWidth * ratio;
      node.height = node.offsetHeight * ratio;
      const ctx = node.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);
      padRef.current?.clear();
    });
    resizeObserver.observe(node);
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!padRef.current || padRef.current.isEmpty()) {
        throw new Error("Please provide a signature before submitting.");
      }

      const dataUrl = padRef.current.toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();

      const formData = new FormData();
      formData.append("signerName", signerName);
      formData.append("templateId", template.id);
      formData.append("signatureImage", blob, "signature.png");

      const res = await fetch(`/api/public/sign/${token}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to submit signature");
      }
      return res.json();
    },
    onSuccess: () => {
      onSigned();
    },
  });

  const clearSignature = () => {
    padRef.current?.clear();
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            {company && <p className="text-sm text-muted-foreground">{company.name}</p>}
            <h1 className="text-xl font-semibold">{template.name}</h1>
          </div>
          <Badge variant="outline" data-testid="badge-step-progress">
            {stepIndex + 1} of {totalSteps}
          </Badge>
        </div>

        {!documentViewed ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5" />
                Review Document
              </CardTitle>
              <CardDescription>Please read this document before signing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px] flex flex-col items-center justify-center gap-3">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="font-medium">{template.name}</p>
                <Button variant="outline" asChild data-testid="button-open-document">
                  <a
                    href={
                      template.filePath.startsWith("/objects/")
                        ? template.filePath
                        : `/objects/${template.filePath}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Document
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground">
                  ({template.mimeType || "document"},{" "}
                  {template.fileSize
                    ? `${Math.round(template.fileSize / 1024)} KB`
                    : "unknown size"}
                  )
                </p>
              </div>
              <Button
                className="w-full"
                data-testid="button-confirm-read"
                onClick={() => setDocumentViewed(true)}
              >
                I Have Read This Document — Continue to Sign
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PenLine className="h-5 w-5" />
                Sign: {template.name}
              </CardTitle>
              <CardDescription>
                Draw your signature in the box below. Signing as: <strong>{signerName}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg bg-white dark:bg-white overflow-hidden"
                style={{ height: 180 }}
              >
                <canvas
                  ref={canvasCallback}
                  data-testid="canvas-signature"
                  className="w-full h-full touch-none"
                  style={{ display: "block" }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">Draw your signature above</p>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  data-testid="button-clear-signature"
                  onClick={clearSignature}
                  disabled={!padReady}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1"
                  data-testid="button-submit-signature"
                  disabled={submitMutation.isPending || !padReady}
                  onClick={() => submitMutation.mutate()}
                >
                  {submitMutation.isPending ? "Submitting..." : "Submit Signature"}
                </Button>
              </div>

              {submitMutation.error && (
                <p
                  className="text-sm text-destructive text-center"
                  data-testid="text-signature-error"
                >
                  {(submitMutation.error as Error).message}
                </p>
              )}

              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  By submitting your signature, you agree that this electronic signature is the
                  legal equivalent of your manual/handwritten signature on this document. You
                  consent to legally be bound by this document. Signed by:{" "}
                  <strong>{signerName}</strong>.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
