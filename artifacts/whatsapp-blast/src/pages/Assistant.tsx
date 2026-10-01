import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Send, Plus, Trash2, Loader2, Database, AlertCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "فشل الطلب");
  return d;
};

const SUGGESTIONS = [
  "كيف أداء حملاتي هذا الأسبوع؟",
  "كم عميلاً مهتماً عندي ولم أتابعه؟",
  "اكتب لي رسالة حملة لعرض نهاية الأسبوع",
  "ليش نسبة التسليم عندي منخفضة؟",
];

export default function Assistant() {
  const qc = useQueryClient();
  // ?thread=ID opens a thread directly — how the knowledge page hands over
  // to the interview it just started.
  const [threadId, setThreadId] = useState<number | null>(() => {
    const q = new URLSearchParams(window.location.search).get("thread");
    return q && /^\d+$/.test(q) ? Number(q) : null;
  });
  const [input, setInput] = useState("");
  const [showContext, setShowContext] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: threads = [] } = useQuery<any[]>({ queryKey: ["as-threads"], queryFn: () => api("/api/assistant/threads") });
  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ["as-msgs", threadId],
    queryFn: () => threadId ? api(`/api/assistant/threads/${threadId}`) : Promise.resolve([]),
    enabled: !!threadId,
  });
  const { data: ctx } = useQuery<any>({ queryKey: ["as-context"], queryFn: () => api("/api/assistant/context") });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = useMutation({
    mutationFn: (message: string) => api("/api/assistant/chat", { method: "POST", body: JSON.stringify({ threadId, message }) }),
    onSuccess: (d: any) => {
      if (!threadId) setThreadId(d.threadId);
      if (d.error) toast.error(d.error);
      qc.invalidateQueries({ queryKey: ["as-msgs", d.threadId] });
      qc.invalidateQueries({ queryKey: ["as-threads"] });
      setThreadId(d.threadId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/assistant/threads/${id}`, { method: "DELETE" }),
    onSuccess: () => { setThreadId(null); qc.invalidateQueries({ queryKey: ["as-threads"] }); },
  });

  const interview = useMutation({
    mutationFn: () => api("/api/assistant/interview", { method: "POST" }),
    onSuccess: (d: any) => { setThreadId(d.threadId); qc.invalidateQueries({ queryKey: ["as-threads"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (text?: string) => {
    const m = (text ?? input).trim();
    if (!m || send.isPending) return;
    setInput("");
    send.mutate(m);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Threads */}
      <aside className="w-60 border-l border-card-border p-3 space-y-2 overflow-y-auto shrink-0 hidden md:block">
        <button
          onClick={() => setThreadId(null)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
        >
          <Plus className="w-4 h-4" /> محادثة جديدة
        </button>
        <button
          onClick={() => interview.mutate()} disabled={interview.isPending}
          title="عشرة أسئلة من رئيسة الفريق، تكتب منها ملف المحل وقاعدة المعرفة"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-primary/40 text-primary hover:bg-primary/10"
        >
          🎤 مقابلة التأهيل
        </button>
        {threads.map((t) => (
          <div key={t.id} className={cn("group flex items-center gap-1 rounded-lg", threadId === t.id && "bg-muted")}>
            <button onClick={() => setThreadId(t.id)} className="flex-1 text-right px-3 py-2 text-xs truncate text-muted-foreground hover:text-foreground">
              {t.title}
            </button>
            <button onClick={() => del.mutate(t.id)} className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          </div>
        ))}
      </aside>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-card-border p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">المساعد الداخلي</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {ctx?.configured ? `يعمل عبر ${ctx.provider} · يرى بيانات حسابك الحقيقية` : "لا يوجد نموذج مضبوط"}
              </p>
            </div>
          </div>
          <button onClick={() => setShowContext(!showContext)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-card-border text-xs hover:border-primary/50 shrink-0">
            <Database className="w-3.5 h-3.5" /> ما يعرفه
          </button>
        </div>

        {showContext && (
          <div className="border-b border-card-border p-3 bg-muted/30">
            <p className="text-[11px] text-muted-foreground mb-2">
              هذه اللقطة تُرسل معه في كل سؤال — فأجوبته مبنية على أرقامك لا على تخمين.
            </p>
            <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">{ctx?.context ?? "…"}</pre>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!ctx?.configured && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-200 leading-relaxed">
                المساعد يحتاج نموذجاً. أضف مفتاحاً مجانياً في <code>.env</code> وأعد التشغيل —
                الخيارات (منها الصينية المجانية) في صفحة «معرفة البوت».
              </p>
            </div>
          )}

          {messages.length === 0 && (
            <div className="text-center py-8 space-y-4">
              <Bot className="w-10 h-10 text-primary/40 mx-auto" />
              <p className="text-sm text-muted-foreground">اسألني عن حسابك، أو اطلب مني أكتب لك رسالة</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => submit(s)}
                    className="px-3 py-1.5 rounded-lg border border-card-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                m.role === "user" ? "bg-muted" : "bg-primary/15")}>
                {m.role === "user" ? <User className="w-4 h-4 text-muted-foreground" /> : <Bot className="w-4 h-4 text-primary" />}
              </div>
              <div className={cn("max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                m.role === "user" ? "bg-muted" : "bg-card border border-card-border")}>
                {m.content}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-xl px-3.5 py-2.5 bg-card border border-card-border">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-card-border p-3">
          <div className="flex gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)} dir="rtl" rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="اكتب سؤالك… (Enter للإرسال، Shift+Enter لسطر جديد)"
              className="flex-1 px-3 py-2.5 bg-input border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring max-h-32"
            />
            <button onClick={() => submit()} disabled={!input.trim() || send.isPending}
              className="px-4 rounded-lg bg-primary text-primary-foreground disabled:opacity-40">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
