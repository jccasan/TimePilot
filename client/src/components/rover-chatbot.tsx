import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, X, Send, Bug, Lightbulb, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

type ChatMessage = {
  id: string;
  role: "user" | "rover";
  text: string;
  timestamp: Date;
  actions?: ("ticket" | "feature")[];
};

type View = "chat" | "ticket-form";

export default function RoverChatbot() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "rover",
      text: "Hey there! I'm Rover, your ScooPilot assistant. Ask me anything about how the app works, or I can help you submit a trouble ticket or feature request.",
      timestamp: new Date(),
    },
  ]);

  const [ticketType, setTicketType] = useState<"bug" | "feature_request" | "question">("bug");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && view === "chat") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, view]);

  if (!user) return null;

  const addMessage = (role: "user" | "rover", text: string, actions?: ("ticket" | "feature")[]) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role, text, timestamp: new Date(), actions },
    ]);
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    addMessage("user", q);
    setSending(true);

    try {
      const res = await apiRequest("POST", "/api/rover/ask", { question: q });
      const data = await res.json();
      addMessage("rover", data.answer, data.matched ? undefined : ["ticket", "feature"]);
    } catch {
      addMessage("rover", "Sorry, something went wrong. Please try again.");
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

  const openTicketForm = (type: "bug" | "feature_request") => {
    setTicketType(type);
    setTicketSubject("");
    setTicketDescription("");
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
      addMessage("rover", `Your ${label.toLowerCase()} "${ticketSubject.trim()}" has been submitted. We'll review it and follow up.`);
    } catch {
      toast({ title: "Failed to submit", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmittingTicket(false);
    }
  };

  return (
    <>
      {!open && (
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
              <span className="font-semibold text-sm">Rover</span>
              <span className="text-xs opacity-80">ScooPilot Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} className="hover:opacity-80" data-testid="button-rover-close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {view === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      {msg.actions && (
                        <div className="flex gap-2 mt-2">
                          {msg.actions.includes("ticket") && (
                            <button
                              onClick={() => openTicketForm("bug")}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-background/20 hover:bg-background/30 transition-colors border border-current/20"
                              data-testid="button-rover-submit-ticket"
                            >
                              <Bug className="h-3 w-3" /> Report Issue
                            </button>
                          )}
                          {msg.actions.includes("feature") && (
                            <button
                              onClick={() => openTicketForm("feature_request")}
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
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground">
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
                    placeholder="Ask about any feature..."
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
