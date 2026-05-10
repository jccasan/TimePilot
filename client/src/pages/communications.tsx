import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Message, Contact } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  MessageSquare,
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
  ArrowLeft,
  User,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import {
  compressMessageAttachment,
  ALLOWED_IMAGE_TYPES,
  MAX_ATTACHMENT_SIZE,
} from "@/lib/compress-image";

const emailFormSchema = z.object({
  contactId: z.string().optional(),
  to: z.string().email("Valid email required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
});

const smsFormSchema = z.object({
  contactId: z.string().optional(),
  to: z.string().min(10, "Valid phone number required"),
  body: z.string().min(1, "Message is required"),
});

type EmailFormValues = z.infer<typeof emailFormSchema>;
type SmsFormValues = z.infer<typeof smsFormSchema>;

type Conversation = {
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  lastMessage: Message;
  unreadCount: number;
  messageCount: number;
  channel: string;
  emailThreadId: string;
  subject: string;
};

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "outbound")
    return <ArrowUpRight className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
  return <ArrowDownLeft className="h-4 w-4 text-green-500 dark:text-green-400" />;
}

function ConversationThread({
  contactId,
  contactName,
  phone,
  onBack,
}: {
  contactId: string;
  contactName: string;
  phone: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedPreviews, setAttachedPreviews] = useState<string[]>([]);
  const [originalFileSizes, setOriginalFileSizes] = useState<number[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadKey = contactId || `phone:${phone}`;

  const { data: threadMessages, isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", "sms", threadKey],
    queryFn: async () => {
      const params = new URLSearchParams({ channel: "sms" });
      if (contactId) {
        params.set("contactId", contactId);
      } else if (phone) {
        params.set("phone", phone);
      }
      const res = await fetch(`/api/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      if (contactId) {
        await apiRequest("PATCH", `/api/messages/read-by-contact/${contactId}`);
      } else if (phone) {
        await apiRequest("PATCH", "/api/messages/read-by-phone", { phone });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-sms-count"] });
    },
  });

  useEffect(() => {
    if (
      !markReadMutation.isPending &&
      threadMessages &&
      threadMessages.some((m) => m.direction === "inbound" && !m.isRead)
    ) {
      markReadMutation.mutate();
    }
  }, [threadKey, threadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages]);

  useEffect(() => {
    return () => {
      attachedPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;
      if (e.target) e.target.value = "";

      const maxAttach = 5;
      if (attachedFiles.length >= maxAttach) {
        toast({
          title: "Limit reached",
          description: `Maximum ${maxAttach} images per message.`,
          variant: "destructive",
        });
        return;
      }

      setIsCompressing(true);
      try {
        const newFiles: File[] = [];
        const newPreviews: string[] = [];
        const newOrigSizes: number[] = [];

        for (
          let i = 0;
          i < selectedFiles.length && attachedFiles.length + newFiles.length < maxAttach;
          i++
        ) {
          const file = selectedFiles[i];
          if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            toast({
              title: "Unsupported file type",
              description: `${file.name}: Only JPG, PNG, and WebP images are allowed.`,
              variant: "destructive",
            });
            continue;
          }
          if (file.size > MAX_ATTACHMENT_SIZE) {
            toast({
              title: "File too large",
              description: `${file.name}: Maximum size is ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB.`,
              variant: "destructive",
            });
            continue;
          }
          const preCompressSize = file.size;
          const compressed = await compressMessageAttachment(file);
          newFiles.push(compressed);
          newPreviews.push(URL.createObjectURL(compressed));
          newOrigSizes.push(preCompressSize);
        }

        if (newFiles.length > 0) {
          setAttachedFiles((prev) => [...prev, ...newFiles]);
          setAttachedPreviews((prev) => [...prev, ...newPreviews]);
          setOriginalFileSizes((prev) => [...prev, ...newOrigSizes]);
        }
      } catch {
        toast({
          title: "Compression failed",
          description: "Could not process the image.",
          variant: "destructive",
        });
      } finally {
        setIsCompressing(false);
      }
    },
    [toast, attachedFiles.length]
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachedPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setOriginalFileSizes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAllAttachments = useCallback(() => {
    attachedPreviews.forEach((url) => URL.revokeObjectURL(url));
    setAttachedFiles([]);
    setAttachedPreviews([]);
    setOriginalFileSizes([]);
  }, [attachedPreviews]);

  const sendReplyMutation = useMutation({
    mutationFn: async ({
      body,
      files,
      origSizes,
    }: {
      body: string;
      files: File[];
      origSizes: number[];
    }) => {
      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((f) => formData.append("media", f));
        formData.append("to", phone);
        formData.append("body", body);
        if (contactId) formData.append("contactId", contactId);
        if (origSizes.length > 0) formData.append("originalSizes", JSON.stringify(origSizes));
        const res = await fetch("/api/messages/mms", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Send failed" }));
          throw new Error(err.error || "Failed to send MMS");
        }
        return res.json();
      } else {
        await apiRequest("POST", "/api/messages/sms", {
          contactId: contactId || undefined,
          to: phone,
          body,
        });
      }
    },
    onMutate: async ({ body }) => {
      const cacheKey = ["/api/messages", "sms", threadKey];
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<Message[]>(cacheKey);
      const optimisticMsg: Message = {
        id: `optimistic-${Date.now()}`,
        companyId: "",
        contactId: contactId || null,
        channel: "sms",
        direction: "outbound",
        status: "queued",
        fromAddress: "",
        toAddress: phone,
        subject: null,
        body,
        htmlBody: null,
        externalId: null,
        metadata: null,
        sentBy: null,
        errorMessage: null,
        isRead: true,
        createdAt: new Date(),
        mediaUrls: [],
        mediaCount: 0,
        emailThreadId: null,
      };
      queryClient.setQueryData<Message[]>(cacheKey, (old) =>
        old ? [...old, optimisticMsg] : [optimisticMsg]
      );
      return { previous, cacheKey };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.cacheKey, context.previous);
      }
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    },
    onSuccess: () => {
      setReplyText("");
      clearAllAttachments();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
    },
  });

  const handleSendReply = useCallback(() => {
    const trimmed = replyText.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    setReplyText("");
    sendReplyMutation.mutate({ body: trimmed, files: attachedFiles, origSizes: originalFileSizes });
  }, [replyText, attachedFiles, originalFileSizes, sendReplyMutation]);

  const sortedMessages = threadMessages
    ? [...threadMessages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden"
          data-testid="button-thread-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate" data-testid="text-thread-contact-name">
              {contactName}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-thread-phone">
              {phone}
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-muted-foreground text-sm"
            data-testid="text-no-thread-messages"
          >
            No messages yet. Send a text to start the conversation.
          </div>
        ) : (
          sortedMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              data-testid={`bubble-message-${msg.id}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  msg.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {msg.mediaUrls && msg.mediaUrls.length > 0 && (
                  <div className="mb-1.5 space-y-1">
                    {msg.mediaUrls.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`media-link-${msg.id}-${idx}`}
                      >
                        <img
                          src={url}
                          alt="Attached image"
                          className="rounded max-w-full max-h-48 object-cover cursor-pointer"
                          loading="lazy"
                          data-testid={`media-img-${msg.id}-${idx}`}
                        />
                      </a>
                    ))}
                  </div>
                )}
                {msg.body && <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>}
                <div
                  className={`flex items-center gap-1.5 mt-1 ${msg.direction === "outbound" ? "justify-end" : ""}`}
                >
                  <span
                    className={`text-[10px] ${msg.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t shrink-0 space-y-2">
        {attachedPreviews.length > 0 && (
          <div className="flex gap-2 flex-wrap" data-testid="mms-preview-container">
            {attachedPreviews.map((preview, idx) => (
              <div key={idx} className="relative inline-block">
                <img
                  src={preview}
                  alt={`Attached ${idx + 1}`}
                  className="h-16 w-16 object-cover rounded border"
                  data-testid={`mms-preview-img-${idx}`}
                />
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs"
                  data-testid={`button-remove-attachment-${idx}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {isCompressing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Compressing image...
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-mms-file"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendReplyMutation.isPending || isCompressing}
            data-testid="button-attach-image"
            title="Attach image"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendReply();
              }
            }}
            disabled={sendReplyMutation.isPending}
            data-testid="input-sms-reply"
          />
          <Button
            onClick={handleSendReply}
            disabled={
              (!replyText.trim() && attachedFiles.length === 0) || sendReplyMutation.isPending
            }
            size="icon"
            data-testid="button-send-reply"
          >
            {sendReplyMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailThread({
  emailThreadId,
  contactId,
  contactName,
  emailAddress,
  subject,
  onBack,
}: {
  emailThreadId: string;
  contactId: string;
  contactName: string;
  emailAddress: string;
  subject: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: threadMessages, isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", "email", emailThreadId],
    queryFn: async () => {
      const params = new URLSearchParams({ channel: "email", emailThreadId });
      const res = await fetch(`/api/messages?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!emailThreadId,
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/messages/read-by-email-thread/${emailThreadId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-email-count"] });
    },
  });

  useEffect(() => {
    if (
      !markReadMutation.isPending &&
      threadMessages &&
      threadMessages.some((m) => m.direction === "inbound" && !m.isRead)
    ) {
      markReadMutation.mutate();
    }
  }, [emailThreadId, threadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages]);

  const sendReplyMutation = useMutation({
    mutationFn: async (body: string) => {
      await apiRequest("POST", "/api/messages/email", {
        contactId: contactId || undefined,
        to: emailAddress,
        subject: subject.startsWith("Re: ") ? subject : `Re: ${subject}`,
        body,
        emailThreadId,
      });
    },
    onMutate: async (body) => {
      const cacheKey = ["/api/messages", "email", emailThreadId];
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<Message[]>(cacheKey);
      const optimisticMsg: Message = {
        id: `optimistic-${Date.now()}`,
        companyId: "",
        contactId: contactId || null,
        channel: "email",
        direction: "outbound",
        status: "queued",
        fromAddress: "",
        toAddress: emailAddress,
        subject: subject.startsWith("Re: ") ? subject : `Re: ${subject}`,
        body,
        htmlBody: null,
        externalId: null,
        metadata: null,
        sentBy: null,
        errorMessage: null,
        isRead: true,
        createdAt: new Date(),
        mediaUrls: [],
        mediaCount: 0,
        emailThreadId,
      };
      queryClient.setQueryData<Message[]>(cacheKey, (old) =>
        old ? [...old, optimisticMsg] : [optimisticMsg]
      );
      return { previous, cacheKey };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.cacheKey, context.previous);
      }
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    },
    onSuccess: () => {
      setReplyText("");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
    },
  });

  const handleSendReply = useCallback(() => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    setReplyText("");
    sendReplyMutation.mutate(trimmed);
  }, [replyText, sendReplyMutation]);

  const sortedMessages = threadMessages
    ? [...threadMessages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden"
          data-testid="button-email-thread-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate" data-testid="text-email-thread-contact">
              {contactName}
            </p>
            <p
              className="text-xs text-muted-foreground truncate"
              data-testid="text-email-thread-subject"
            >
              {subject}
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-muted-foreground text-sm"
            data-testid="text-no-email-messages"
          >
            No messages in this thread.
          </div>
        ) : (
          sortedMessages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg border p-3 ${
                msg.direction === "outbound"
                  ? "ml-8 bg-primary/5 border-primary/20"
                  : "mr-8 bg-muted/50"
              }`}
              data-testid={`email-message-${msg.id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DirectionIcon direction={msg.direction} />
                  <span>
                    {msg.direction === "outbound"
                      ? `To: ${msg.toAddress}`
                      : `From: ${msg.fromAddress}`}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(msg.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {msg.subject && msg.subject !== subject && (
                <p className="text-xs font-medium text-muted-foreground mb-1">{msg.subject}</p>
              )}
              {msg.mediaUrls && msg.mediaUrls.length > 0 && (
                <div className="mb-2 flex gap-2 flex-wrap">
                  {msg.mediaUrls.map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`email-media-link-${msg.id}-${idx}`}
                    >
                      <img
                        src={url}
                        alt="Attachment"
                        className="rounded max-h-32 object-cover border"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              )}
              <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
              {msg.status === "failed" && msg.errorMessage && (
                <p className="text-xs text-destructive mt-1">{msg.errorMessage}</p>
              )}
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t shrink-0 space-y-2">
        <div className="flex gap-2">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your reply..."
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSendReply();
              }
            }}
            disabled={sendReplyMutation.isPending}
            data-testid="textarea-email-reply"
          />
          <Button
            onClick={handleSendReply}
            disabled={!replyText.trim() || sendReplyMutation.isPending}
            size="icon"
            className="shrink-0 self-end"
            data-testid="button-send-email-reply"
          >
            {sendReplyMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Press Ctrl+Enter to send</p>
      </div>
    </div>
  );
}

function ConversationList({
  conversations,
  isLoading,
  selectedKey,
  onSelect,
}: {
  conversations: Conversation[];
  isLoading: boolean;
  selectedKey: string | null;
  onSelect: (conv: Conversation) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div
        className="p-6 text-center text-muted-foreground text-sm"
        data-testid="text-no-conversations"
      >
        No conversations yet
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full">
      {conversations.map((conv) => {
        const convKey =
          conv.channel === "email"
            ? `email:${conv.emailThreadId}`
            : `sms:${conv.contactId || conv.phone}`;

        return (
          <button
            key={convKey}
            onClick={() => onSelect(conv)}
            className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors flex items-start gap-3 ${
              selectedKey === convKey ? "bg-muted" : ""
            }`}
            data-testid={`conversation-item-${conv.channel}-${conv.contactId || conv.emailThreadId || "unknown"}`}
          >
            <div
              className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                conv.channel === "email" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-primary/10"
              }`}
            >
              {conv.channel === "email" ? (
                <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              ) : (
                <MessageSquare className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm truncate ${conv.unreadCount > 0 ? "font-semibold" : "font-medium"}`}
                >
                  {conv.contactName}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: true })}
                </span>
              </div>
              {conv.channel === "email" && conv.subject && (
                <p className="text-xs text-muted-foreground truncate">{conv.subject}</p>
              )}
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p
                  className={`text-xs truncate ${conv.unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {conv.lastMessage.direction === "outbound" ? "You: " : ""}
                  {conv.lastMessage.body}
                </p>
                {conv.unreadCount > 0 && (
                  <Badge
                    variant="default"
                    className="h-5 min-w-[20px] px-1.5 text-[10px] shrink-0"
                    data-testid={`badge-unread-${convKey}`}
                  >
                    {conv.unreadCount}
                  </Badge>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function UnifiedInbox({ channelFilter }: { channelFilter?: string }) {
  const [location] = useLocation();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [handledContactId, setHandledContactId] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/messages/conversations", channelFilter],
    queryFn: async () => {
      const url = channelFilter
        ? `/api/messages/conversations?channel=${channelFilter}`
        : "/api/messages/conversations";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/contacts?all=true", { credentials: "include", headers });
      return r.ok ? r.json() : [];
    },
  });

  useEffect(() => {
    if (channelFilter === "email") return;
    const params = new URLSearchParams(window.location.search);
    const contactId = params.get("contactId");
    if (!contactId || contactId === handledContactId) return;

    const conv = conversations.find((c) => c.contactId === contactId && c.channel === "sms");
    if (conv) {
      setSelectedConversation(conv);
      setHandledContactId(contactId);
      return;
    }

    if (!isLoading && contacts) {
      const contact = contacts.find((c) => c.id === contactId);
      if (contact && contact.phone) {
        setSelectedConversation({
          contactId: contact.id,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          phone: contact.phone,
          email: "",
          lastMessage: { id: "", body: "", createdAt: new Date() } as unknown as Message,
          unreadCount: 0,
          messageCount: 0,
          channel: "sms",
          emailThreadId: "",
          subject: "",
        });
        setHandledContactId(contactId);
      }
    }
  }, [conversations, contacts, location, handledContactId, isLoading, channelFilter]);

  useEffect(() => {
    setSelectedConversation(null);
  }, [channelFilter]);

  const handleSelect = useCallback((conv: Conversation) => {
    setSelectedConversation(conv);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedConversation(null);
  }, []);

  const selectedKey = selectedConversation
    ? selectedConversation.channel === "email"
      ? `email:${selectedConversation.emailThreadId}`
      : `sms:${selectedConversation.contactId || selectedConversation.phone}`
    : null;

  const renderThread = () => {
    if (!selectedConversation) {
      return (
        <div
          className="flex-1 flex items-center justify-center text-muted-foreground"
          data-testid="text-select-conversation"
        >
          <div className="text-center">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Select a conversation to view messages</p>
          </div>
        </div>
      );
    }

    if (selectedConversation.channel === "email") {
      return (
        <EmailThread
          emailThreadId={selectedConversation.emailThreadId}
          contactId={selectedConversation.contactId}
          contactName={selectedConversation.contactName}
          emailAddress={selectedConversation.email}
          subject={selectedConversation.subject}
          onBack={handleBack}
        />
      );
    }

    return (
      <ConversationThread
        contactId={selectedConversation.contactId}
        contactName={selectedConversation.contactName}
        phone={selectedConversation.phone}
        onBack={handleBack}
      />
    );
  };

  if (isMobile) {
    return (
      <Card className="flex-1 overflow-hidden">
        <div className="h-[calc(100vh-220px)]">
          {selectedConversation ? (
            renderThread()
          ) : (
            <ConversationList
              conversations={conversations}
              isLoading={isLoading}
              selectedKey={null}
              onSelect={handleSelect}
            />
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex-1 overflow-hidden">
      <div className="flex h-[calc(100vh-220px)]">
        <div className="w-80 border-r flex flex-col shrink-0">
          <div className="p-3 border-b">
            <h3 className="font-medium text-sm">Conversations</h3>
          </div>
          <ConversationList
            conversations={conversations}
            isLoading={isLoading}
            selectedKey={selectedKey}
            onSelect={handleSelect}
          />
        </div>
        <div className="flex-1 flex flex-col">{renderThread()}</div>
      </div>
    </Card>
  );
}

export default function Communications() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("contactId")) {
      setActiveTab("sms");
    }
  }, []);

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/contacts?all=true", { credentials: "include", headers });
      return r.ok ? r.json() : [];
    },
  });

  const { data: config } = useQuery<{
    email: { configured: boolean };
    sms: { configured: boolean; phoneNumber: string };
  }>({
    queryKey: ["/api/messages/config"],
  });

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { contactId: "", to: "", subject: "", body: "" },
  });

  const smsForm = useForm<SmsFormValues>({
    resolver: zodResolver(smsFormSchema),
    defaultValues: { contactId: "", to: "", body: "" },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (data: EmailFormValues) => {
      await apiRequest("POST", "/api/messages/email", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      toast({ title: "Email sent" });
      setEmailDialogOpen(false);
      emailForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send email", description: error.message, variant: "destructive" });
    },
  });

  const sendSmsMutation = useMutation({
    mutationFn: async (data: SmsFormValues) => {
      await apiRequest("POST", "/api/messages/sms", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-sms-count"] });
      toast({ title: "SMS sent" });
      setSmsDialogOpen(false);
      smsForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send SMS", description: error.message, variant: "destructive" });
    },
  });

  const handleContactSelectEmail = (contactId: string) => {
    emailForm.setValue("contactId", contactId);
    const contact = contacts?.find((c) => c.id === contactId);
    if (contact?.email) emailForm.setValue("to", contact.email);
  };

  const handleContactSelectSms = (contactId: string) => {
    smsForm.setValue("contactId", contactId);
    const contact = contacts?.find((c) => c.id === contactId);
    if (contact?.phone) smsForm.setValue("to", contact.phone);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-communications-heading">
          Messages
        </h1>
        <div className="flex items-center gap-2">
          <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-compose-email">
                <Mail className="mr-1 h-4 w-4" /> Email
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Compose Email</DialogTitle>
              </DialogHeader>
              {!config?.email?.configured && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" /> SendGrid API key not configured
                </div>
              )}
              <Form {...emailForm}>
                <form
                  onSubmit={emailForm.handleSubmit((v) => sendEmailMutation.mutate(v))}
                  className="space-y-4"
                >
                  <FormField
                    control={emailForm.control}
                    name="contactId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact (optional)</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                            handleContactSelectEmail(v);
                          }}
                          value={field.value || ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-email-contact">
                              <SelectValue placeholder="Select a contact" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {contacts
                              ?.filter((c) => c.email)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.firstName} {c.lastName} - {c.email}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={emailForm.control}
                    name="to"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" data-testid="input-email-to" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={emailForm.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-email-subject" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={emailForm.control}
                    name="body"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={5} data-testid="textarea-email-body" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={sendEmailMutation.isPending}
                    data-testid="button-send-email"
                  >
                    <Send className="mr-1 h-4 w-4" />
                    {sendEmailMutation.isPending ? "Sending..." : "Send Email"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-compose-sms">
                <MessageSquare className="mr-1 h-4 w-4" /> New SMS
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Text Message</DialogTitle>
              </DialogHeader>
              {!config?.sms?.configured && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" /> Twilio credentials not configured
                </div>
              )}
              {config?.sms?.phoneNumber && (
                <p className="text-sm text-muted-foreground">From: {config.sms.phoneNumber}</p>
              )}
              <Form {...smsForm}>
                <form
                  onSubmit={smsForm.handleSubmit((v) => sendSmsMutation.mutate(v))}
                  className="space-y-4"
                >
                  <FormField
                    control={smsForm.control}
                    name="contactId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact (optional)</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                            handleContactSelectSms(v);
                          }}
                          value={field.value || ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-sms-contact">
                              <SelectValue placeholder="Select a contact" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {contacts
                              ?.filter((c) => c.phone)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.firstName} {c.lastName} - {c.phone}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={smsForm.control}
                    name="to"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-sms-to" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={smsForm.control}
                    name="body"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} data-testid="textarea-sms-body" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={sendSmsMutation.isPending}
                    data-testid="button-send-sms"
                  >
                    <Send className="mr-1 h-4 w-4" />
                    {sendSmsMutation.isPending ? "Sending..." : "Send SMS"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all-messages">
            All
          </TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sms-inbox">
            SMS
          </TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-email-messages">
            Email
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <UnifiedInbox />
        </TabsContent>

        <TabsContent value="sms" className="mt-4">
          <UnifiedInbox channelFilter="sms" />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <UnifiedInbox channelFilter="email" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
