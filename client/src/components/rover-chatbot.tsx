import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, X, Send, Bug, Lightbulb, ArrowLeft, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import roverImage from "@assets/ChatGPT_Image_Mar_4,_2026,_12_09_01_PM_1772644163091.png";

type ChatMessage = {
  id: string;
  role: "user" | "rover";
  text: string;
  timestamp: Date;
  actions?: ("ticket" | "feature")[];
  streaming?: boolean;
  suggestedSubject?: string;
  suggestedDescription?: string;
  isFallback?: boolean;
};

type View = "chat" | "ticket-form";

export default function RoverChatbot() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "rover",
      text: "Hey there! I'm Rover, your ScooPilot assistant. I can answer questions about the app, look up your business data, or help you submit a trouble ticket or feature request.",
      timestamp: new Date(),
    },
  ]);

  const [ticketType, setTicketType] = useState<"bug" | "feature_request" | "question">("bug");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && aiAvailable === null) {
      fetch("/api/rover/status", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => setAiAvailable(data.aiAvailable ?? false))
        .catch(() => setAiAvailable(false));
    }
  }, [open, aiAvailable]);

  useEffect(() => {
    if (user) {
      const key = `rover_intro_seen_${user.id}`;
      if (!localStorage.getItem(key)) {
        setShowIntro(true);
      }
    }
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && view === "chat") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, view]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!user) return null;

  const dismissIntro = () => {
    const key = `rover_intro_seen_${user.id}`;
    localStorage.setItem(key, "true");
    setShowIntro(false);
  };

  const dismissAndOpen = () => {
    dismissIntro();
    setOpen(true);
  };

  const clearChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setMessages([
      {
        id: "welcome",
        role: "rover",
        text: "Hey there! I'm Rover, your ScooPilot assistant. I can answer questions about the app, look up your business data, or help you submit a trouble ticket or feature request.",
        timestamp: new Date(),
      },
    ]);
  };

  const getConversationHistory = () => {
    return messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
  };

  const parseActions = (text: string): {
    cleanText: string;
    actions: ("ticket" | "feature")[];
    suggestedSubject?: string;
    suggestedDescription?: string;
  } => {
    const actions: ("ticket" | "feature")[] = [];
    let cleanText = text;
    let suggestedSubject: string | undefined;
    let suggestedDescription: string | undefined;

    if (text.includes("[SUGGEST_TICKET]")) {
      actions.push("ticket");
      cleanText = cleanText.replace(/\[SUGGEST_TICKET\]/g, "").trim();
    }
    if (text.includes("[SUGGEST_FEATURE]")) {
      actions.push("feature");
      cleanText = cleanText.replace(/\[SUGGEST_FEATURE\]/g, "").trim();
    }

    const subjectMatch = cleanText.match(/SUBJECT:\s*(.+)/i);
    if (subjectMatch) {
      suggestedSubject = subjectMatch[1].trim();
      cleanText = cleanText.replace(/SUBJECT:\s*.+/i, "").trim();
    }

    const descMatch = cleanText.match(/DESCRIPTION:\s*([\s\S]+)$/im);
    if (descMatch) {
      suggestedDescription = descMatch[1].trim();
      cleanText = cleanText.replace(/DESCRIPTION:\s*[\s\S]+$/im, "").trim();
    }

    return { cleanText, actions, suggestedSubject, suggestedDescription };
  };

  const handleStreamingChat = async (question: string) => {
    const history = getConversationHistory();
    history.push({ role: "user", content: question });

    const streamingMsgId = Date.now().toString() + "-stream";
    setMessages((prev) => [
      ...prev,
      {
        id: streamingMsgId,
        role: "rover",
        text: "",
        timestamp: new Date(),
        streaming: true,
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/rover/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        credentials: "include",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMsgId
                ? { ...m, text: "You're sending messages too quickly. Please wait a moment and try again.", streaming: false }
                : m
            )
          );
          return;
        }
        const errorData = await response.json().catch(() => ({}));
        if (errorData.fallback) {
          throw new Error("FALLBACK");
        }
        throw new Error(errorData.error || "Chat request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "chunk") {
              fullText += event.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamingMsgId ? { ...m, text: fullText } : m
                )
              );
            } else if (event.type === "done") {
              const { cleanText, actions, suggestedSubject, suggestedDescription } = parseActions(fullText);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamingMsgId
                    ? { ...m, text: cleanText, streaming: false, actions: actions.length > 0 ? actions : undefined, suggestedSubject, suggestedDescription }
                    : m
                )
              );
            } else if (event.type === "error") {
              throw new Error("FALLBACK");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (fullText) {
        const { cleanText, actions, suggestedSubject, suggestedDescription } = parseActions(fullText);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsgId
              ? { ...m, text: cleanText, streaming: false, actions: actions.length > 0 ? actions : undefined, suggestedSubject, suggestedDescription }
              : m
          )
        );
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;

      if (err.message === "FALLBACK") {
        await handleKeywordFallback(question, streamingMsgId);
        return;
      }

      await handleKeywordFallback(question, streamingMsgId);
    } finally {
      abortRef.current = null;
    }
  };

  const handleKeywordFallback = async (question: string, replaceId?: string) => {
    try {
      const res = await apiRequest("POST", "/api/rover/ask", { question });
      const data = await res.json();
      const fallbackMsg: ChatMessage = {
        id: replaceId || Date.now().toString(),
        role: "rover",
        text: data.answer,
        timestamp: new Date(),
        actions: data.matched ? undefined : ["ticket", "feature"],
        isFallback: true,
      };

      if (replaceId) {
        setMessages((prev) => prev.map((m) => (m.id === replaceId ? fallbackMsg : m)));
      } else {
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: replaceId || Date.now().toString(),
        role: "rover",
        text: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
      };
      if (replaceId) {
        setMessages((prev) => prev.map((m) => (m.id === replaceId ? errorMsg : m)));
      } else {
        setMessages((prev) => [...prev, errorMsg]);
      }
    }
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", text: q, timestamp: new Date() },
    ]);

    setSending(true);
    try {
      await handleStreamingChat(q);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openTicketForm = (type: "bug" | "feature_request", subject?: string, description?: string) => {
    setTicketType(type);
    setTicketSubject(subject || "");
    setTicketDescription(description || "");
    setView("ticket-form");
  };

  const submitTicket = async () => {
    if (ticketSubject.trim().length < 3 || ticketDescription.trim().length < 10) return;
    setSubmittingTicket(true);
    try {
      await apiRequest("POST", "/api/rover/ticket", {
        type: ticketType,
        subject: ticketSubject.trim(),
        description: ticketDescription.trim(),
      });
      const label = ticketType === "bug" ? "Trouble ticket" : ticketType === "feature_request" ? "Feature request" : "Question";
      toast({ title: `${label} submitted`, description: "We'll review it soon." });
      setView("chat");
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "rover",
          text: `Your ${label.toLowerCase()} "${ticketSubject.trim()}" has been submitted. We'll review it and follow up.`,
          timestamp: new Date(),
        },
      ]);
    } catch {
      toast({ title: "Failed to submit", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmittingTicket(false);
    }
  };

  return (
    <>
      {showIntro && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" data-testid="rover-intro-overlay">
          <div className="bg-background rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-300" data-testid="rover-intro-modal">
            <div className="relative">
              <img
                src={roverImage}
                alt="Rover - Your ScooPilot Assistant"
                className="w-full h-56 object-cover object-top"
                data-testid="img-rover-intro"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <h2 className="absolute bottom-3 left-4 text-white text-xl font-bold tracking-tight">
                Meet Rover
              </h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-foreground leading-relaxed">
                Rover is your built-in ScooPilot assistant, now powered by AI. Ask questions about the app, look up your business data, or get help with any issue.
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2">
                  <MessageCircle className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Ask questions about any feature</span>
                </li>
                <li className="flex items-start gap-2">
                  <Bug className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Submit trouble tickets for bugs</span>
                </li>
                <li className="flex items-start gap-2">
                  <Lightbulb className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Request new features</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Look for the green button in the bottom-right corner anytime.
              </p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={dismissIntro} data-testid="button-rover-intro-dismiss">
                  Got it
                </Button>
                <Button className="flex-1" onClick={dismissAndOpen} data-testid="button-rover-intro-open">
                  Say hi to Rover
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!open && !showIntro && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[100] flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105"
          data-testid="button-rover-open"
          aria-label="Open Rover assistant"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[100] w-[380px] max-w-[calc(100vw-40px)] h-[520px] max-h-[calc(100vh-100px)] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden" data-testid="rover-chatbot-panel">
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground shrink-0">
            <div className="flex items-center gap-2">
              {view === "ticket-form" && (
                <button onClick={() => setView("chat")} className="hover:opacity-80" data-testid="button-rover-back">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <img src={roverImage} alt="Rover" className="w-6 h-6 rounded-full object-cover" />
              <span className="font-semibold text-sm">Rover</span>
              <span className="text-xs opacity-80">
                {aiAvailable === false ? "Basic Mode" : "AI Assistant"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {view === "chat" && messages.length > 1 && (
                <button onClick={clearChat} className="hover:opacity-80 p-1" data-testid="button-rover-clear" title="Clear conversation">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="hover:opacity-80 p-1" data-testid="button-rover-close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {view === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      {msg.streaming && (
                        <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5 align-text-bottom" />
                      )}
                      {msg.isFallback && !msg.streaming && (
                        <p className="text-[10px] opacity-50 mt-1 italic">AI temporarily unavailable - basic mode</p>
                      )}
                      {msg.actions && !msg.streaming && (
                        <div className="flex gap-2 mt-2">
                          {msg.actions.includes("ticket") && (
                            <button
                              onClick={() => openTicketForm("bug", msg.suggestedSubject, msg.suggestedDescription)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-background/20 hover:bg-background/30 transition-colors border border-current/20"
                              data-testid="button-rover-submit-ticket"
                            >
                              <Bug className="h-3 w-3" /> Report Issue
                            </button>
                          )}
                          {msg.actions.includes("feature") && (
                            <button
                              onClick={() => openTicketForm("feature_request", msg.suggestedSubject, msg.suggestedDescription)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-background/20 hover:bg-background/30 transition-colors border border-current/20"
                              data-testid="button-rover-submit-feature"
                            >
                              <Lightbulb className="h-3 w-3" /> Request Feature
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && !messages.some((m) => m.streaming) && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-1.5">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:300ms]" />
                      </span>
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="shrink-0 p-3 border-t">
                <div className="flex gap-2 mb-2">
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openTicketForm("bug")} data-testid="button-rover-bug">
                    <Bug className="h-3 w-3 mr-1" /> Trouble Ticket
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openTicketForm("feature_request")} data-testid="button-rover-feature">
                    <Lightbulb className="h-3 w-3 mr-1" /> Feature Request
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Rover anything..."
                    className="text-sm"
                    disabled={sending}
                    data-testid="input-rover-question"
                  />
                  <Button size="icon" className="shrink-0" onClick={handleSend} disabled={!input.trim() || sending} data-testid="button-rover-send">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {view === "ticket-form" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <h3 className="font-semibold text-sm">
                {ticketType === "bug" ? "Submit Trouble Ticket" : "Submit Feature Request"}
              </h3>

              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={ticketType} onValueChange={(v: "bug" | "feature_request" | "question") => setTicketType(v)}>
                  <SelectTrigger className="text-sm" data-testid="select-rover-ticket-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">Trouble Ticket / Bug</SelectItem>
                    <SelectItem value="feature_request">Feature Request</SelectItem>
                    <SelectItem value="question">General Question</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Input
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="Brief summary..."
                  className="text-sm"
                  data-testid="input-rover-ticket-subject"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={ticketDescription}
                  onChange={(e) => setTicketDescription(e.target.value)}
                  placeholder="Describe the issue or feature in detail..."
                  className="text-sm min-h-[120px]"
                  data-testid="textarea-rover-ticket-description"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setView("chat")} className="flex-1" data-testid="button-rover-ticket-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={submitTicket}
                  disabled={submittingTicket || ticketSubject.trim().length < 3 || ticketDescription.trim().length < 10}
                  className="flex-1"
                  data-testid="button-rover-ticket-submit"
                >
                  {submittingTicket ? "Submitting..." : "Submit"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
