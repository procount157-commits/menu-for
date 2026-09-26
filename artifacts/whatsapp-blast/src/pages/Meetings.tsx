import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Play, MessageSquareQuote, HelpCircle, CornerDownLeft, Gavel,
  Megaphone, ChevronDown, ChevronUp, Clock, PauseCircle, Check, X, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/components/AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

// Each kind of turn reads differently, and colour is what makes a transcript
// skimmable — the question and the answer are what a reader looks for.
const TURN = {
  open:     { icon: Megaphone,          label: "يفتتح", cls: "border-r-primary/60",     tint: "" },
  report:   { icon: MessageSquareQuote, label: "يعرض",  cls: "border-r-card-border",    tint: "" },
  question: { icon: HelpCircle,         label: "يسأل",  cls: "border-r-yellow-500/70",  tint: "bg-yellow-500/5" },
  answer:   { icon: CornerDownLeft,     label: "يجيب",  cls: "border-r-blue-500/70",    tint: "bg-blue-500/5" },
  decide:   { icon: Gavel,              label: "يقرّر", cls: "border-r-primary",        tint: "bg-primary/5" },
} as const;

const when = (d: string) =>
  new Date(d).toLocaleString("ar-AE", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" });

export default function Meetings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);

  const { data: board } = useQuery<any>({ queryKey: ["board"], queryFn: () => api("/api/board") });
  const { data: list = [], isLoading } = useQuery<any[]>({
    queryKey: ["meetings"], queryFn: () => api("/api/meetings"), refetchInterval: 60_000,
  });
  const { data: pending = [] } = useQuery<any[]>({
    queryKey: ["meeting-proposals"], queryFn: () => api("/api/meetings/proposals/pending"), refetchInterval: 60_000,
  });
  const { data: detail } = useQuery<any>({
    queryKey: ["meeting", open], queryFn: () => api(`/api/meetings/${open}`), enabled: !!open,
  });

  const team: any[] = board?.columns ?? [];
  const who = (role: string) => team.find((t) => t.role === role) ?? { name: role, avatar: "🙂" };

  const decide = useMutation({
    mutationFn: ({ id, verdict }: { id: number; verdict: "approve" | "reject" }) =>
      api(`/api/meetings/proposals/${id}/${verdict}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast[v.verdict === "approve" ? "success" : "info"](v.verdict === "approve" ? "طُبِّق" : "رُفض");
      qc.invalidateQueries({ queryKey: ["meeting-proposals"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: () => api("/api/meetings/run", { method: "POST", body: JSON.stringify({ kind: "daily" }) }),
    onSuccess: (d: any) => {
      if (d.error) { toast.error(d.error); return; }
      toast.success(`انتهى الاجتماع — ${d.decisions?.length ?? 0} قرار`);
      setOpen(d.id);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">اجتماعات الفريق</h1>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            يجتمعون كل مساء على أرقام اليوم. كل واحد يقرأ ما قاله من سبقه ويردّ عليه، وشمّة تسأل
            من يحتاج توضيحاً وتختم بقرارات تُكتب في ذاكرة من تخصّه.
          </p>
        </div>
        <button onClick={() => run.mutate()} disabled={run.isPending} className={ghost}>
          {run.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {run.isPending ? "الاجتماع جارٍ…" : "اعقد اجتماعاً الآن"}
        </button>
      </div>

      {/* Decisions that would stop or limit sending — the owner's call, not theirs */}
      {pending.length > 0 && (
        <div className={cn(card, "border-yellow-500/40")}>
          <div className="p-4 border-b border-card-border">
            <p className="font-semibold text-sm flex items-center gap-1.5">
              <PauseCircle className="w-4 h-4 text-yellow-400" />
              قرارات تنتظر موافقتك ({pending.length})
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              رأوا أن هذه لازمة، لكنها توقف الإرسال أو تجمّد المتابعة — ولا تُطبَّق إلا بإذنك.
            </p>
          </div>
          <div className="divide-y divide-card-border">
            {pending.map((p) => (
              <div key={p.id} className="p-4 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{p.roleName}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{p.rule}</p>
                  {p.reason && <p className="text-[10px] text-muted-foreground/70 mt-1.5">{p.reason}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => decide.mutate({ id: p.id, verdict: "approve" })}
                          disabled={decide.isPending}
                          className={cn(ghost, "border-primary/40 text-primary")}>
                    <Check className="w-3.5 h-3.5" /> وافق
                  </button>
                  <button onClick={() => decide.mutate({ id: p.id, verdict: "reject" })}
                          disabled={decide.isPending}
                          className={cn(ghost, "border-red-500/30 text-red-400")}>
                    <X className="w-3.5 h-3.5" /> ارفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {run.isPending && (
        <div className={cn(card, "p-4 flex items-center gap-3")}>
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            يتكلّمون بالدور، وكل واحد ينتظر أن يقرأ ما قيل قبله — يستغرق دقيقة أو دقيقتين.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <p className={cn(card, "p-10 text-sm text-muted-foreground text-center")}>
          لم يجتمعوا بعد. اضغط «اعقد اجتماعاً الآن».
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((m) => {
            const isOpen = open === m.id;
            const decisions: any[] = m.decisions ?? [];
            return (
              <div key={m.id} className={card}>
                <button onClick={() => setOpen(isOpen ? null : m.id)}
                        className="w-full p-4 text-right flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{m.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                      <Clock className="w-3 h-3" /> {when(m.startedAt)}
                      {decisions.length > 0 && ` · ${decisions.length} قرار`}
                      {m.couldDecide === false && (
                        <span className="flex items-center gap-1 text-yellow-400">
                          <FlaskConical className="w-3 h-3" />
                          ناقشوا بلا قرار — {m.evidenceCount ?? 0} نتيجة مقيسة فقط
                        </span>
                      )}
                    </p>
                    {m.summary && !isOpen && (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">{m.summary}</p>
                    )}
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                          : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                </button>

                {isOpen && (
                  <div className="border-t border-card-border">
                    {!detail ? (
                      <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                      <>
                        <div className="p-4 space-y-3">
                          {(detail.turns ?? []).map((t: any) => {
                            const meta = TURN[t.kind as keyof typeof TURN] ?? TURN.report;
                            const p = who(t.role);
                            return (
                              <div key={t.id} className={cn("border-r-2 pr-3 py-2 rounded-l-lg", meta.cls, meta.tint)}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-base leading-none">{p.avatar}</span>
                                  <span className="text-xs font-semibold">{p.name}</span>
                                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <meta.icon className="w-3 h-3" /> {meta.label}
                                  </span>
                                </div>
                                <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                              </div>
                            );
                          })}
                        </div>

                        {decisions.length > 0 && (
                          <div className="p-4 border-t border-card-border bg-primary/5">
                            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                              <Gavel className="w-3.5 h-3.5 text-primary" /> ما صار قاعدة في ذاكرتهم
                            </p>
                            <div className="space-y-1.5">
                              {decisions.map((d, i) => (
                                <p key={i} className="text-xs leading-relaxed">
                                  <span className="font-medium">{who(d.role).avatar} {d.name}:</span>{" "}
                                  <span className="text-muted-foreground">{d.rule}</span>
                                  {d.status && d.status !== "طُبِّق" && (
                                    <span className="text-yellow-400 text-[10px]"> — {d.status}</span>
                                  )}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
