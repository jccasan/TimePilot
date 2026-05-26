/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { UpgradeWall } from "@/components/upgrade-wall";
import {
  PhoneCall,
  Wand2,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  ExternalLink,
  Zap,
  Save,
  Upload,
  Radio,
  Clock,
} from "lucide-react";

type VoiceWebhookStatus = {
  configured: boolean;
  reason?: string;
  agentId?: string;
  registered?: boolean;
  currentUrl?: string | null;
  expectedUrl?: string | null;
};

type VoiceConfig = {
  voiceAreaCodePreference: string | null;
  voiceNumberPortingStatus: string | null;
  dedicatedPhoneNumber: string | null;
  portingPhoneNumber: string | null;
  websiteUrl: string | null;
  voiceAgentGreeting: string | null;
  voiceAgentPricingSummary: string | null;
  voiceAgentServiceArea: string | null;
  voiceAgentPolicies: string | null;
  voiceAgentSpecialLines: string | null;
  retellAgentId: string | null;
  retellKnowledgeBaseId: string | null;
};

type GeneratedDocs = {
  greeting: string;
  pricingSummary: string;
  serviceArea: string;
  policies: string;
};

type KbDocument = {
  fileId: string;
  filename: string;
  createdAt: string | null;
};

type VoiceCallEntry = {
  id: string;
  contactId: string | null;
  retellCallId: string | null;
  callerPhone: string | null;
  agentPhone: string | null;
  durationSeconds: number;
  durationMinutes: number;
  outcome: string | null;
  summary: string | null;
  recordingUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export default function VoiceChatAgentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: company } = useQuery<{ voicePlanStatus: string | null; phone: string | null }>({
    queryKey: ["/api/company"],
  });

  const hasActiveVoicePlan = company?.voicePlanStatus === "active";

  const [activeTab, setActiveTab] = useState<"configure" | "calls">("configure");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [greeting, setGreeting] = useState("");
  const [pricingSummary, setPricingSummary] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [policies, setPolicies] = useState("");
  const [specialLines, setSpecialLines] = useState("");
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocs | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const docUploadRef = useRef<HTMLInputElement>(null);

  const voiceConfigQuery = useQuery<VoiceConfig>({
    queryKey: ["/api/voice/config"],
    enabled: hasActiveVoicePlan,
  });

  const statusQuery = useQuery<VoiceWebhookStatus>({
    queryKey: ["/api/voice/webhook-status"],
    enabled: hasActiveVoicePlan,
  });

  const callsQuery = useQuery<VoiceCallEntry[]>({
    queryKey: ["/api/voice/calls"],
    enabled: hasActiveVoicePlan && activeTab === "calls",
  });

  const selectedCall = selectedCallId
    ? ((callsQuery.data ?? []).find((c) => c.id === selectedCallId) ?? null)
    : null;

  const kbDocumentsQuery = useQuery<{ documents: KbDocument[] }>({
    queryKey: ["/api/voice/kb-documents"],
    enabled: hasActiveVoicePlan && activeTab === "configure",
  });

  useEffect(() => {
    if (voiceConfigQuery.data) {
      const d = voiceConfigQuery.data;
      const phoneAreaCode = company?.phone?.replace(/\D/g, "").slice(0, 3) ?? "";
      setAreaCode(d.voiceAreaCodePreference || phoneAreaCode);
      setWebsiteUrl(d.websiteUrl || "");
      setGreeting(d.voiceAgentGreeting || "");
      setPricingSummary(d.voiceAgentPricingSummary || "");
      setServiceArea(d.voiceAgentServiceArea || "");
      setPolicies(d.voiceAgentPolicies || "");
      setSpecialLines(d.voiceAgentSpecialLines || "");
    }
  }, [voiceConfigQuery.data, company?.phone]);

  const saveConfigMutation = useMutation({
    mutationFn: async (fields: Record<string, string | null>) => {
      const res = await apiRequest("PATCH", "/api/voice/config", fields);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Voice agent configuration saved." });
      qc.invalidateQueries({ queryKey: ["/api/voice/config"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const generateDocsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/voice/generate-docs", {});
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Generation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedDocs(data);
      setGreeting(data.greeting || greeting);
      setPricingSummary(data.pricingSummary || pricingSummary);
      setServiceArea(data.serviceArea || serviceArea);
      setPolicies(data.policies || policies);
      toast({ title: "AI content generated", description: "Review and edit below, then save." });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const uploadDocMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/voice/upload-document", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Document uploaded",
        description: data.message || "File added to knowledge base.",
      });
      setUploadFileName(null);
      if (docUploadRef.current) docUploadRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["/api/voice/kb-documents"] });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const res = await apiRequest("DELETE", `/api/voice/kb-documents/${fileId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document deleted", description: "File removed from the knowledge base." });
      qc.invalidateQueries({ queryKey: ["/api/voice/kb-documents"] });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const syncAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/voice/sync-agent", {});
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Agent synced",
        description: data.results?.join("; ") || "Voice agent updated successfully.",
      });
      qc.invalidateQueries({ queryKey: ["/api/voice/config"] });
      qc.invalidateQueries({ queryKey: ["/api/voice/webhook-status"] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const syncUrlMutation = useMutation({
    mutationFn: async () => {
      const saveRes = await apiRequest("PATCH", "/api/voice/config", {
        websiteUrl: websiteUrl || null,
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save website URL");
      }
      const syncRes = await apiRequest("POST", "/api/voice/sync-agent", {});
      if (!syncRes.ok) {
        const d = await syncRes.json().catch(() => ({}));
        throw new Error(d.error || "Sync failed");
      }
      return syncRes.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Knowledge base synced",
        description: data.results?.join("; ") || "Website URL synced to agent knowledge base.",
      });
      qc.invalidateQueries({ queryKey: ["/api/voice/config"] });
      qc.invalidateQueries({ queryKey: ["/api/voice/webhook-status"] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const reregisterMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/voice/register-webhook"),
    onSuccess: () => {
      toast({ title: "Webhook registered", description: "Voice agent webhook re-registered." });
      qc.invalidateQueries({ queryKey: ["/api/voice/webhook-status"] });
    },
    onError: (err: any) => {
      toast({
        title: "Registration failed",
        description: err?.message || "Could not re-register.",
        variant: "destructive",
      });
    },
  });

  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    uploadDocMutation.mutate(file);
  };

  const handleSaveConfig = () => {
    saveConfigMutation.mutate({
      voiceAreaCodePreference: areaCode.replace(/\D/g, "").slice(0, 3) || null,
      websiteUrl: websiteUrl || null,
      voiceAgentGreeting: greeting || null,
      voiceAgentPricingSummary: pricingSummary || null,
      voiceAgentServiceArea: serviceArea || null,
      voiceAgentPolicies: policies || null,
      voiceAgentSpecialLines: specialLines || null,
    });
  };

  if (!hasActiveVoicePlan) {
    return (
      <div className="p-4 md:p-6 overflow-auto h-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Voice/Chat Agent</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure your AI phone and chat agent.
          </p>
        </div>
        <UpgradeWall type="voice" featureName="Voice/Chat Agent" />
      </div>
    );
  }

  const cfg = voiceConfigQuery.data;
  const status = statusQuery.data;
  const portingStatus = cfg?.voiceNumberPortingStatus;
  const portingLabels: Record<string, { label: string; color: string }> = {
    pending: {
      label: "Porting Requested",
      color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    },
    in_progress: {
      label: "Porting In Progress",
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    complete: {
      label: "Porting Complete",
      color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
  };

  const tabs: { key: "configure" | "calls"; label: string; icon: React.ElementType }[] = [
    { key: "configure", label: "Configure", icon: Wand2 },
    { key: "calls", label: "Call Logs", icon: FileText },
  ];

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-voice-agent-title">
          Voice/Chat Agent
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your AI phone agent, manage your dedicated number, and push settings to Retell.
        </p>
      </div>

      <Card className="max-w-4xl" data-testid="card-voice-agent">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5" />
            Agent Setup
          </CardTitle>
          <CardDescription>
            Manage your dedicated number, scripts, and knowledge base.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {voiceConfigQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : (
            <>
              {/* Tab Navigation */}
              <div className="flex border-b">
                {tabs.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === key
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`tab-voice-${key}`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Configure Tab */}
              {activeTab === "configure" && (
                <div className="space-y-6 pt-1">
                  {/* Phone Number Section */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone Number
                    </p>
                    {cfg?.dedicatedPhoneNumber ? (
                      <div className="rounded-lg border bg-muted/30 p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Your Dedicated Number</p>
                        <p
                          className="text-2xl font-bold tracking-wide text-foreground"
                          data-testid="text-voice-phone-number"
                        >
                          {cfg.dedicatedPhoneNumber}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This number is routed to your AI voice agent.
                        </p>
                      </div>
                    ) : cfg?.portingPhoneNumber ? (
                      <div className="rounded-lg border p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-amber-500" />
                          <span className="text-sm font-medium">Number Porting In Progress</span>
                          {portingStatus && portingLabels[portingStatus] && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${portingLabels[portingStatus].color}`}
                              data-testid="badge-porting-status"
                            >
                              {portingLabels[portingStatus].label}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Porting{" "}
                          <span className="font-mono font-medium">{cfg.portingPhoneNumber}</span> —
                          typically 2–4 weeks
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Our team will contact you once the porting process is complete.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
                        <Radio className="h-6 w-6 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">No dedicated number yet.</p>
                        <p className="text-xs text-muted-foreground">
                          Set an area code preference below, then click "Push to Agent" to provision
                          your number.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="voice-area-code">Preferred Area Code</Label>
                      <div className="flex gap-2">
                        <Input
                          id="voice-area-code"
                          value={areaCode}
                          onChange={(e) =>
                            setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
                          }
                          placeholder="e.g. 206"
                          maxLength={3}
                          className="w-32"
                          data-testid="input-voice-area-code"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            saveConfigMutation.mutate({
                              voiceAreaCodePreference:
                                areaCode.replace(/\D/g, "").slice(0, 3) || null,
                            })
                          }
                          disabled={saveConfigMutation.isPending}
                          data-testid="button-save-area-code"
                        >
                          {saveConfigMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Save
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        3-digit area code for your new number. Used when provisioning via "Push to
                        Agent."
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Agent Scripts Section */}
                  <div className="space-y-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Agent Scripts &amp; Knowledge
                    </p>

                    <div className="space-y-2">
                      <Label htmlFor="voice-website">Website URL (Knowledge Base Source)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="voice-website"
                          value={websiteUrl}
                          onChange={(e) => setWebsiteUrl(e.target.value)}
                          placeholder="https://yourcompany.com"
                          className="flex-1"
                          data-testid="input-voice-website-url"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncUrlMutation.mutate()}
                          disabled={syncUrlMutation.isPending || !websiteUrl}
                          data-testid="button-sync-website-url"
                        >
                          {syncUrlMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Sync to KB
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Saves the URL and immediately rebuilds the agent's knowledge base from your
                        website content.
                      </p>
                    </div>

                    <div className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <Wand2 className="h-4 w-4 text-primary" />
                            AI Generate Scripts
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Generate greeting, pricing summary, service area, and policies from your
                            existing data.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generateDocsMutation.mutate()}
                          disabled={generateDocsMutation.isPending}
                          data-testid="button-voice-generate-docs"
                        >
                          {generateDocsMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating…
                            </>
                          ) : (
                            <>
                              <Wand2 className="h-4 w-4 mr-1" /> AI Generate
                            </>
                          )}
                        </Button>
                      </div>
                      {generatedDocs && (
                        <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                          Content generated — review and edit the fields below, then click Save All.
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-greeting">Agent Greeting</Label>
                      <Textarea
                        id="voice-greeting"
                        value={greeting}
                        onChange={(e) => setGreeting(e.target.value)}
                        placeholder="Thank you for calling [Company Name]! How can I help you today?"
                        rows={2}
                        data-testid="input-voice-greeting"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-pricing">Pricing Summary</Label>
                      <Textarea
                        id="voice-pricing"
                        value={pricingSummary}
                        onChange={(e) => setPricingSummary(e.target.value)}
                        placeholder="Our weekly service starts at $25 for one dog..."
                        rows={3}
                        data-testid="input-voice-pricing-summary"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-service-area">Service Area Description</Label>
                      <Textarea
                        id="voice-service-area"
                        value={serviceArea}
                        onChange={(e) => setServiceArea(e.target.value)}
                        placeholder="We serve the greater Seattle area including Bellevue, Redmond, and Kirkland..."
                        rows={2}
                        data-testid="input-voice-service-area"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-policies">Policies &amp; Notes for Agent</Label>
                      <Textarea
                        id="voice-policies"
                        value={policies}
                        onChange={(e) => setPolicies(e.target.value)}
                        placeholder="We require gate access. Cancellations need 24 hours notice..."
                        rows={3}
                        data-testid="input-voice-policies"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-special-lines">Special Script Lines (optional)</Label>
                      <Textarea
                        id="voice-special-lines"
                        value={specialLines}
                        onChange={(e) => setSpecialLines(e.target.value)}
                        placeholder="If customer asks about discounts, mention our referral program..."
                        rows={2}
                        data-testid="input-voice-special-lines"
                      />
                    </div>

                    <Button
                      onClick={handleSaveConfig}
                      disabled={saveConfigMutation.isPending}
                      className="w-full"
                      data-testid="button-voice-save-all"
                    >
                      {saveConfigMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save All Configuration
                    </Button>

                    <Separator />

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <FileText className="h-4 w-4" />
                        Upload Document to Knowledge Base
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        PDF, TXT, or DOCX files are pushed directly to your agent's knowledge base.
                        {!cfg?.retellKnowledgeBaseId && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" "}
                            Run "Push to Agent" first to create the knowledge base.
                          </span>
                        )}
                      </p>
                      <div className="flex gap-2 items-center">
                        <input
                          ref={docUploadRef}
                          type="file"
                          accept=".pdf,.txt,.docx"
                          onChange={handleDocUpload}
                          className="hidden"
                          data-testid="input-voice-doc-upload"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => docUploadRef.current?.click()}
                          disabled={uploadDocMutation.isPending || !cfg?.retellKnowledgeBaseId}
                          data-testid="button-voice-upload-doc"
                        >
                          {uploadDocMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading…
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-1" /> Choose File
                            </>
                          )}
                        </Button>
                        {uploadFileName && !uploadDocMutation.isPending && (
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {uploadFileName}
                          </span>
                        )}
                      </div>
                      {cfg?.retellKnowledgeBaseId && (
                        <p className="text-xs text-muted-foreground">
                          KB ID:{" "}
                          <code className="bg-muted px-1 rounded">{cfg.retellKnowledgeBaseId}</code>
                        </p>
                      )}
                    </div>

                    {cfg?.retellKnowledgeBaseId && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5">
                          <FileText className="h-4 w-4" />
                          Uploaded Documents
                        </Label>
                        {kbDocumentsQuery.isLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-9 w-full" />
                            <Skeleton className="h-9 w-full" />
                          </div>
                        ) : kbDocumentsQuery.data?.documents?.length === 0 ||
                          !kbDocumentsQuery.data?.documents ? (
                          <p className="text-xs text-muted-foreground py-2">
                            No documents uploaded yet. Click Choose File to add one.
                          </p>
                        ) : (
                          <div className="rounded-md border divide-y">
                            {kbDocumentsQuery.data.documents.map((doc) => (
                              <div
                                key={doc.fileId}
                                className="flex items-center justify-between px-3 py-2 gap-2"
                                data-testid={`kb-document-row-${doc.fileId}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p
                                    className="text-sm truncate"
                                    data-testid={`text-kb-filename-${doc.fileId}`}
                                  >
                                    {doc.filename}
                                  </p>
                                  {doc.createdAt && (
                                    <p
                                      className="text-xs text-muted-foreground"
                                      data-testid={`text-kb-date-${doc.fileId}`}
                                    >
                                      {new Date(doc.createdAt).toLocaleDateString()}
                                    </p>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteDocMutation.mutate(doc.fileId)}
                                  disabled={deleteDocMutation.isPending}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                  data-testid={`button-delete-kb-doc-${doc.fileId}`}
                                >
                                  {deleteDocMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                  <span className="sr-only">Delete</span>
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Sync Agent Section */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Agent Status &amp; Sync
                    </p>

                    <div className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Push to Agent</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Provisions your number (if needed), creates or refreshes the knowledge
                            base, updates agent prompts, and registers the webhook.
                          </p>
                        </div>
                        <Button
                          onClick={() => syncAgentMutation.mutate()}
                          disabled={syncAgentMutation.isPending}
                          size="sm"
                          data-testid="button-voice-sync-agent"
                        >
                          {syncAgentMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Syncing…
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4 mr-1" /> Push to Agent
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {statusQuery.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-6 w-3/4" />
                      </div>
                    ) : status ? (
                      <>
                        <div className="flex items-start gap-3 rounded-lg border p-4">
                          {!status.configured ? (
                            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                          ) : status.registered ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 mt-0.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                          )}
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Webhook Status</span>
                              <Badge
                                variant={
                                  !status.configured
                                    ? "secondary"
                                    : status.registered
                                      ? "default"
                                      : "destructive"
                                }
                                className={
                                  status.registered
                                    ? "bg-green-600 hover:bg-green-700 text-white"
                                    : ""
                                }
                                data-testid="badge-voice-webhook-status"
                              >
                                {!status.configured
                                  ? "Unknown"
                                  : status.registered
                                    ? "Registered"
                                    : "Not Registered"}
                              </Badge>
                            </div>
                            {status.reason && (
                              <p
                                className="text-xs text-muted-foreground"
                                data-testid="text-voice-webhook-reason"
                              >
                                {status.reason}
                              </p>
                            )}
                            {status.configured && status.expectedUrl && (
                              <div className="space-y-1 pt-1">
                                <p className="text-xs text-muted-foreground">
                                  <span className="font-medium">Expected: </span>
                                  <code
                                    className="bg-muted px-1 py-0.5 rounded break-all"
                                    data-testid="text-voice-expected-url"
                                  >
                                    {status.expectedUrl}
                                  </code>
                                </p>
                                {status.currentUrl ? (
                                  <p className="text-xs text-muted-foreground">
                                    <span className="font-medium">Registered: </span>
                                    <code
                                      className={`px-1 py-0.5 rounded break-all ${status.registered ? "bg-muted" : "bg-destructive/10 text-destructive"}`}
                                      data-testid="text-voice-current-url"
                                    >
                                      {status.currentUrl}
                                    </code>
                                  </p>
                                ) : (
                                  <p
                                    className="text-xs text-muted-foreground"
                                    data-testid="text-voice-no-webhook"
                                  >
                                    No webhook URL set on agent.
                                  </p>
                                )}
                              </div>
                            )}
                            {status.agentId && (
                              <p className="text-xs text-muted-foreground pt-1">
                                Agent ID:{" "}
                                <code
                                  className="bg-muted px-1 py-0.5 rounded"
                                  data-testid="text-voice-agent-id"
                                >
                                  {status.agentId}
                                </code>
                              </p>
                            )}
                          </div>
                        </div>

                        {status.configured && (
                          <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">Re-register Webhook</p>
                              <p className="text-xs text-muted-foreground">
                                {status.registered
                                  ? "Webhook is active. Force re-registration if calls aren't recording."
                                  : "Webhook is missing or mismatched. Register it now."}
                              </p>
                            </div>
                            <Button
                              variant={status.registered ? "outline" : "default"}
                              size="sm"
                              onClick={() => reregisterMutation.mutate()}
                              disabled={reregisterMutation.isPending}
                              data-testid="button-voice-reregister-webhook"
                            >
                              {reregisterMutation.isPending ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Registering…
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-4 w-4 mr-1" /> Re-register Webhook
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Unable to load webhook status.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Call Logs Tab */}
              {activeTab === "calls" && (
                <div className="space-y-3 pt-1">
                  {callsQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : !callsQuery.data || callsQuery.data.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center">
                      <PhoneCall className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No call records yet.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Calls handled by your voice agent will appear here.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {callsQuery.data.length} call
                          {callsQuery.data.length !== 1 ? "s" : ""} total &nbsp;·&nbsp;
                          {callsQuery.data.reduce((s, c) => s + (c.durationMinutes || 0), 0)} min
                        </p>
                      </div>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm" data-testid="table-call-log">
                          <thead>
                            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                              <th className="py-2 px-3">Date / Time</th>
                              <th className="py-2 px-3">Caller</th>
                              <th className="py-2 px-3">Duration</th>
                              <th className="py-2 px-3">Outcome</th>
                              <th className="py-2 px-3">Recording</th>
                              <th className="py-2 px-3">Summary</th>
                              <th className="py-2 px-3 text-right">Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {callsQuery.data.map((call) => (
                              <tr
                                key={call.id}
                                className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                                data-testid={`row-call-${call.id}`}
                              >
                                <td className="py-2 px-3 whitespace-nowrap text-xs">
                                  {new Date(call.createdAt).toLocaleDateString()}{" "}
                                  <span className="text-muted-foreground">
                                    {new Date(call.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap text-xs font-mono">
                                  {call.callerPhone || "Unknown"}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap text-xs">
                                  {call.durationMinutes > 0
                                    ? `${call.durationMinutes}m ${call.durationSeconds % 60}s`
                                    : `${call.durationSeconds}s`}
                                </td>
                                <td className="py-2 px-3">
                                  <Badge
                                    variant={
                                      call.outcome === "successful" ? "default" : "secondary"
                                    }
                                    className={
                                      call.outcome === "successful"
                                        ? "bg-green-600 hover:bg-green-700 text-white text-xs"
                                        : "text-xs"
                                    }
                                    data-testid={`badge-call-outcome-${call.id}`}
                                  >
                                    {call.outcome || "unknown"}
                                  </Badge>
                                  {call.contactId && (
                                    <a
                                      href={`/contacts/${call.contactId}`}
                                      className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                                      data-testid={`link-call-contact-${call.id}`}
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Contact
                                    </a>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-xs">
                                  {call.recordingUrl ? (
                                    <a
                                      href={call.recordingUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-primary hover:underline"
                                      data-testid={`link-recording-${call.id}`}
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Listen
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                                  {call.summary || "--"}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setSelectedCallId(call.id)}
                                    data-testid={`button-call-details-${call.id}`}
                                  >
                                    View
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  <Dialog
                    open={!!selectedCall}
                    onOpenChange={(open) => {
                      if (!open) setSelectedCallId(null);
                    }}
                  >
                    <DialogContent className="max-w-lg" data-testid="dialog-call-detail">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <PhoneCall className="h-4 w-4" />
                          Call Detail
                        </DialogTitle>
                      </DialogHeader>
                      {selectedCall && (
                        <div className="space-y-4 text-sm">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Date</p>
                              <p className="font-medium">
                                {new Date(selectedCall.createdAt).toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Caller</p>
                              <p className="font-mono font-medium">
                                {selectedCall.callerPhone || "Unknown"}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Duration</p>
                              <p className="font-medium">
                                {selectedCall.durationMinutes > 0
                                  ? `${selectedCall.durationMinutes}m ${selectedCall.durationSeconds % 60}s`
                                  : `${selectedCall.durationSeconds}s`}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Outcome</p>
                              <Badge
                                variant={
                                  selectedCall.outcome === "successful" ? "default" : "secondary"
                                }
                                className={
                                  selectedCall.outcome === "successful"
                                    ? "bg-green-600 text-white text-xs mt-0.5"
                                    : "text-xs mt-0.5"
                                }
                              >
                                {selectedCall.outcome || "unknown"}
                              </Badge>
                            </div>
                            {selectedCall.contactId && (
                              <div className="col-span-2">
                                <p className="text-muted-foreground">Linked Contact</p>
                                <a
                                  href={`/contacts/${selectedCall.contactId}`}
                                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                                  data-testid="link-detail-contact"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View Contact Record
                                </a>
                              </div>
                            )}
                          </div>

                          {selectedCall.summary && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Summary</p>
                              <p className="text-sm leading-relaxed bg-muted/40 rounded p-3">
                                {selectedCall.summary}
                              </p>
                            </div>
                          )}

                          {(() => {
                            const analysis = selectedCall.metadata?.callAnalysis as
                              | Record<string, unknown>
                              | undefined;
                            const transcript = analysis?.transcript as string | undefined;
                            return transcript ? (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Transcript</p>
                                <div
                                  className="text-xs leading-relaxed bg-muted/40 rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap"
                                  data-testid="text-call-transcript"
                                >
                                  {transcript}
                                </div>
                              </div>
                            ) : null;
                          })()}

                          {selectedCall.recordingUrl && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Recording</p>
                              <audio
                                controls
                                src={selectedCall.recordingUrl}
                                className="w-full h-10"
                                data-testid="audio-call-recording"
                              />
                              <a
                                href={selectedCall.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                                data-testid="link-call-recording"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Open recording in new tab
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                      <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setSelectedCallId(null)}>
                          Close
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
