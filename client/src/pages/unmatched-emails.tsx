import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Inbox,
  Link2,
  EyeOff,
  Search,
  ChevronLeft,
  ChevronRight,
  Mail,
  UserPlus,
} from "lucide-react";
import { useQuery as useContactSearch } from "@tanstack/react-query";
import { format } from "date-fns";

interface InboundEmail {
  id: string;
  tenantId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  matchedContactId: string | null;
  status: "matched" | "unmatched" | "ignored";
  createdAt: string;
}

interface ContactResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "comcast.net",
  "aol.com",
  "live.com",
  "msn.com",
  "ymail.com",
  "protonmail.com",
  "proton.me",
  "googlemail.com",
]);

const BUSINESS_KEYWORDS =
  /\b(llc|inc|corp|co|ltd|limited|group|associates|solutions|services|consulting|enterprises|partners)\b/i;

function parseSenderInfo(
  fromName: string | null,
  fromAddress: string
): {
  firstName: string;
  lastName: string;
  companyName: string;
} {
  const domain = fromAddress.split("@")[1]?.toLowerCase() ?? "";
  const isPersonalDomain = PERSONAL_DOMAINS.has(domain);

  let firstName = "";
  let lastName = "";
  let companyName = "";

  if (fromName && fromName.trim()) {
    const name = fromName.trim();

    // "Last, First" format
    const commaMatch = name.match(/^([^,]+),\s*(.+)$/);
    if (commaMatch) {
      firstName = commaMatch[2].trim();
      lastName = commaMatch[1].trim();
    } else {
      const parts = name.split(/\s+/);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    }

    // If the name looks like a business and the domain is not personal, pre-fill company
    if (!isPersonalDomain && (BUSINESS_KEYWORDS.test(name) || name.split(/\s+/).length > 2)) {
      companyName = name;
      // Still try to derive a first name from email local part as fallback
      if (!firstName || BUSINESS_KEYWORDS.test(firstName)) {
        const localPart = fromAddress.split("@")[0] ?? "";
        const derived = localPart.split(/[._-]/)[0] ?? "";
        firstName = derived.charAt(0).toUpperCase() + derived.slice(1);
        lastName = "";
        // company stays as the full name
      }
    }
  } else {
    // No display name — derive from email local part
    const localPart = fromAddress.split("@")[0] ?? "";
    const parts = localPart.split(/[._-]/);
    firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : "";
    lastName = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : "";

    // If the domain is not personal, suggest it as a company name
    if (!isPersonalDomain) {
      const domainName = domain.split(".")[0] ?? "";
      companyName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
  }

  return { firstName, lastName, companyName };
}

function ContactPicker({
  onSelect,
  onClose,
}: {
  onSelect: (contact: ContactResult) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const { data: results, isLoading } = useContactSearch<ContactResult[]>({
    queryKey: ["/api/contacts/search", search],
    queryFn: async () => {
      if (!search.trim()) return [];
      const res = await apiRequest(
        "GET",
        `/api/contacts/search?q=${encodeURIComponent(search)}&limit=10`
      );
      return res.json();
    },
    enabled: search.length >= 1,
  });

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Link to Contact</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            data-testid="input-contact-search"
          />
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {isLoading && <Skeleton className="h-8 w-full" />}
          {!isLoading && results && results.length === 0 && search.trim() && (
            <p className="text-xs text-muted-foreground py-2 text-center">No contacts found</p>
          )}
          {results?.map((c) => (
            <button
              key={c.id}
              className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              onClick={() => onSelect(c)}
              data-testid={`button-select-contact-${c.id}`}
            >
              <span className="font-medium">
                {c.firstName || ""} {c.lastName || ""}
              </span>
              {c.email && <span className="text-muted-foreground ml-2 text-xs">{c.email}</span>}
              {c.phone && <span className="text-muted-foreground ml-2 text-xs">{c.phone}</span>}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

interface CreateContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
}

function CreateContactModal({
  email,
  onSuccess,
  onClose,
}: {
  email: InboundEmail;
  onSuccess: (contactId: string) => void;
  onClose: () => void;
}) {
  const defaults = parseSenderInfo(email.fromName, email.fromAddress);
  const [values, setValues] = useState<CreateContactFormValues>({
    firstName: defaults.firstName,
    lastName: defaults.lastName,
    email: email.fromAddress,
    companyName: defaults.companyName,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateContactFormValues, string>>>({});

  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (formValues: CreateContactFormValues) => {
      const payload: Record<string, unknown> = {
        firstName: formValues.firstName.trim(),
        lastName: formValues.lastName.trim(),
        email: formValues.email.trim(),
        status: "lead",
        contactType: formValues.companyName.trim() ? "commercial" : "residential",
      };
      if (formValues.companyName.trim()) {
        payload.companyName = formValues.companyName.trim();
      }
      const res = await apiRequest("POST", "/api/contacts", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create contact");
      }
      return res.json();
    },
    onSuccess: (contact: { id: string }) => {
      onSuccess(contact.id);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to create contact",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function validate(): boolean {
    const errs: Partial<Record<keyof CreateContactFormValues, string>> = {};
    if (!values.firstName.trim()) errs.firstName = "First name is required";
    if (!values.email.trim()) {
      errs.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      errs.email = "Enter a valid email address";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    createMutation.mutate(values);
  }

  function field(
    id: keyof CreateContactFormValues,
    label: string,
    required = false,
    autoFocus = false
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`create-contact-${id}`} className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Input
          id={`create-contact-${id}`}
          value={values[id]}
          onChange={(e) => {
            setValues((v) => ({ ...v, [id]: e.target.value }));
            if (errors[id]) setErrors((er) => ({ ...er, [id]: undefined }));
          }}
          autoFocus={autoFocus}
          data-testid={`input-create-contact-${id}`}
          aria-invalid={!!errors[id]}
        />
        {errors[id] && (
          <p className="text-xs text-destructive" data-testid={`error-create-contact-${id}`}>
            {errors[id]}
          </p>
        )}
      </div>
    );
  }

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Create Contact</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-muted-foreground -mt-1">
          Pre-filled from the email sender. Edit any field before saving.
        </p>
        {field("firstName", "First Name", true, true)}
        {field("lastName", "Last Name")}
        {field("email", "Email", true)}
        {field("companyName", "Company Name")}
        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={createMutation.isPending}
            data-testid="button-create-contact-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={createMutation.isPending}
            data-testid="button-create-contact-save"
          >
            {createMutation.isPending ? "Creating..." : "Create & Link"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EmailRow({
  email,
  onLink,
  onIgnore,
  onCreateContact,
}: {
  email: InboundEmail;
  onLink: (email: InboundEmail) => void;
  onIgnore: (email: InboundEmail) => void;
  onCreateContact: (email: InboundEmail) => void;
}) {
  const preview = email.bodyText?.replace(/\s+/g, " ").trim().slice(0, 120) || "";
  const fromDisplay = email.fromName
    ? `${email.fromName} <${email.fromAddress}>`
    : email.fromAddress;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 border-b last:border-0"
      data-testid={`row-unmatched-email-${email.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium truncate"
            data-testid={`text-email-subject-${email.id}`}
          >
            {email.subject || "(no subject)"}
          </span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {email.status}
          </Badge>
        </div>
        <p
          className="text-xs text-muted-foreground truncate"
          data-testid={`text-email-from-${email.id}`}
        >
          From: {fromDisplay}
        </p>
        {preview && <p className="text-xs text-muted-foreground line-clamp-2">{preview}</p>}
        <p className="text-xs text-muted-foreground">
          {format(new Date(email.createdAt), "MMM d, yyyy h:mm a")}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCreateContact(email)}
          data-testid={`button-create-contact-email-${email.id}`}
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Create Contact
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onLink(email)}
          data-testid={`button-link-email-${email.id}`}
        >
          <Link2 className="h-3.5 w-3.5 mr-1" />
          Link
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onIgnore(email)}
          data-testid={`button-ignore-email-${email.id}`}
        >
          <EyeOff className="h-3.5 w-3.5 mr-1" />
          Ignore
        </Button>
      </div>
    </div>
  );
}

export default function UnmatchedEmailsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showIgnored, setShowIgnored] = useState(false);
  const [linkTarget, setLinkTarget] = useState<InboundEmail | null>(null);
  const [createTarget, setCreateTarget] = useState<InboundEmail | null>(null);
  const limit = 25;

  const { data: ignoredCountData } = useQuery<{ total: number }>({
    queryKey: ["/api/email/unmatched", "ignored-count"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/email/unmatched?page=1&limit=1&include_ignored=true"
      );
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ data: InboundEmail[]; total: number }>({
    queryKey: ["/api/email/unmatched", { page, limit, showIgnored }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(showIgnored ? { include_ignored: "true" } : {}),
      });
      const res = await apiRequest("GET", `/api/email/unmatched?${params}`);
      return res.json();
    },
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, contactId }: { id: string; contactId: string }) =>
      apiRequest("POST", `/api/email/unmatched/${id}/link`, { contact_id: contactId }).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      setLinkTarget(null);
      toast({ title: "Email linked to contact" });
    },
    onError: () => toast({ title: "Failed to link email", variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/email/unmatched/${id}/ignore`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      toast({ title: "Email ignored" });
    },
    onError: () => toast({ title: "Failed to ignore email", variant: "destructive" }),
  });

  const createAndLinkMutation = useMutation({
    mutationFn: ({ emailId, contactId }: { emailId: string; contactId: string }) =>
      apiRequest("POST", `/api/email/unmatched/${emailId}/link`, {
        contact_id: contactId,
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      setCreateTarget(null);
      toast({ title: "Contact created and email linked" });
    },
    onError: () => {
      toast({
        title: "Contact created but email link failed",
        description: "The contact was saved. You can link the email manually.",
        variant: "destructive",
      });
      qc.invalidateQueries({ queryKey: ["/api/email/unmatched"] });
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      setCreateTarget(null);
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;
  const emails = data?.data ?? [];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Mail className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-unmatched-emails-heading">
            Unmatched Email Review
          </h1>
          <p className="text-sm text-muted-foreground">
            Emails forwarded to your CRM address that could not be matched to a contact
          </p>
        </div>
        {data && data.total > 0 && (
          <Badge className="ml-auto" data-testid="badge-unmatched-count">
            {data.total}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4" />
                Unmatched Emails
              </CardTitle>
              <CardDescription className="mt-1">
                Create a new contact or link to an existing one. Linked emails appear in the
                contact's activity timeline.
              </CardDescription>
            </div>
            <Button
              variant={showIgnored ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setShowIgnored((v) => !v);
                setPage(1);
              }}
              className="shrink-0"
              data-testid="button-toggle-ignored"
            >
              <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              {showIgnored
                ? "Hide ignored"
                : `Show ignored${ignoredCountData?.total ? ` (${ignoredCountData.total})` : ""}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2"
              data-testid="text-no-unmatched-emails"
            >
              <Inbox className="h-8 w-8 opacity-40" />
              <p className="text-sm">No unmatched emails</p>
            </div>
          ) : (
            <>
              <div>
                {emails.map((email) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    onLink={setLinkTarget}
                    onIgnore={(e) => ignoreMutation.mutate(e.id)}
                    onCreateContact={setCreateTarget}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page <= 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linkTarget} onOpenChange={(o) => !o && setLinkTarget(null)}>
        {linkTarget && (
          <ContactPicker
            onSelect={(contact) =>
              linkMutation.mutate({ id: linkTarget.id, contactId: contact.id })
            }
            onClose={() => setLinkTarget(null)}
          />
        )}
      </Dialog>

      <Dialog open={!!createTarget} onOpenChange={(o) => !o && setCreateTarget(null)}>
        {createTarget && (
          <CreateContactModal
            email={createTarget}
            onSuccess={(contactId) =>
              createAndLinkMutation.mutate({ emailId: createTarget.id, contactId })
            }
            onClose={() => setCreateTarget(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
