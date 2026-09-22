import { useState, useRef, useEffect } from "react";
import {
  Sparkles, Send, Loader2, Bot, User, Trash2,
  MessageSquarePlus, Wifi, WifiOff, Zap, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetWhatsappStatus } from "@workspace/api-client-react";

// ── Types ───────────────────────────────────────────────────────────

type Role = "user" | "assistant";
interface Message { role: Role; content: string; ts: number }

// ── API helpers ─────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown): Promise<string> {
  const res = await fetch(`/api/ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `خطأ ${res.status}`);
  }
  const data = (await res.json()) as { result: string };
  return data.result;
}

// ── Quick prompts ───────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: "تحسين رسالة",       icon: "✍️", text: "ساعدني في تحسين رسالة واتساب لتكون أكثر تأثيراً وتفاعلاً" },
  { label: "استراتيجية حملة",   icon: "🎯", text: "كيف أبني حملة واتساب ناجحة تصل لأكبر عدد من العملاء؟" },
  { label: "رسالة ترحيب",       icon: "👋", text: "اكتب لي رسالة ترحيب احترافية لعملاء جدد عبر واتساب" },
  { label: "تحليل الاتصال",     icon: "📡", text: "ما هي أفضل إعدادات الاتصال والتأخير لتجنب الحظر في واتساب؟" },
  { label: "رسائل متنوعة",      icon: "🔀", text: "علّمني كيف أستخدم Spintax لتنويع رسائلي وتقليل خطر الحظر" },
  { label: "أوقات الإرسال",     icon: "⏰", text: "ما هي أفضل أوقات إرسال رسائل واتساب التسويقية؟" },
];

// ── Format assistant text ───────────────────────────────────────────

function FormatMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        // Bold **text**
        const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="leading-relaxed text-sm">
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export default function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const bottomRef               = useRef<HTMLDivElement>(null);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status } = useGetWhatsappStatus({ query: { refetchInterval: 10000 } as any });
  const connected = status?.connected;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setError("");

    const userMsg: Message = { role: "user", content: msg, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    try {
      const result = await apiPost("/chat", {
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: result, ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([]);
    setError("");
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="h-full flex flex-col" dir="rtl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card/50 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">مساعد الذكاء الاصطناعي</h1>
            <p className="text-xs text-muted-foreground">مجاني بالكامل — يعمل بـ Pollinations AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* WA status badge */}
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
            connected ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}>
            {connected
              ? <><Wifi className="w-3 h-3" /> واتساب متصل</>
              : <><WifiOff className="w-3 h-3" /> واتساب منقطع</>}
          </div>
          {messages.length > 0 && (
            <button onClick={clear}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              مسح
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] space-y-6">
            {/* Welcome */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">مرحباً! أنا مساعدك الذكي</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                متخصص في تسويق واتساب — يمكنني تحسين رسائلك، تحليل اتصالك، ومساعدتك في بناء حملات ناجحة
              </p>
            </div>

            {/* Quick prompts */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {QUICK_PROMPTS.map((p) => (
                <button key={p.label} onClick={() => void send(p.text)}
                  className="flex items-center gap-2 px-3 py-2.5 bg-card border border-border rounded-xl text-xs font-medium text-foreground hover:bg-primary/5 hover:border-primary/30 transition-all text-right">
                  <span className="text-base flex-shrink-0">{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
            {/* Avatar */}
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
              msg.role === "user" ? "bg-primary/20" : "bg-muted"
            )}>
              {msg.role === "user"
                ? <User className="w-3.5 h-3.5 text-primary" />
                : <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />}
            </div>
            {/* Bubble */}
            <div className={cn(
              "max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
              msg.role === "user"
                ? "bg-primary text-white rounded-tr-sm"
                : "bg-card border border-border text-foreground rounded-tl-sm"
            )}>
              {msg.role === "assistant"
                ? <FormatMessage text={msg.content} />
                : <p>{msg.content}</p>}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:0ms]" />
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
              <span>{error}</span>
              <button onClick={() => void send(messages[messages.length - 1]?.content)}
                className="flex items-center gap-1 hover:text-red-300 transition-colors">
                <RefreshCw className="w-3 h-3" /> إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-4 pb-4 pt-2 border-t border-border flex-shrink-0">
        {/* Quick prompts inline — show after first message */}
        {!isEmpty && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {QUICK_PROMPTS.slice(0, 3).map((p) => (
              <button key={p.label} onClick={() => void send(p.text)}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all disabled:opacity-50">
                <Zap className="w-2.5 h-2.5" />{p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end bg-card border border-border rounded-2xl px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <MessageSquarePlus className="w-4 h-4 text-muted-foreground flex-shrink-0 mb-1.5" />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            placeholder="اكتب سؤالك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none max-h-40 leading-relaxed disabled:opacity-60"
            rows={1}
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all mb-0.5",
              input.trim() && !loading
                ? "bg-primary text-white hover:bg-primary/90 active:scale-95 shadow-sm"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">
          مجاني 100% • لا يحتاج مفتاح API • يعمل بذكاء اصطناعي متقدم
        </p>
      </div>
    </div>
  );
}
