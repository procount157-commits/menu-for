import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Loader2, Play, Clock, MessagesSquare, TrendingUp, TrendingDown, Pin,
  Sparkles, ChevronDown, ChevronUp, Radar, AlertTriangle, CheckCircle2,
  PauseCircle, XCircle, Brain, Inbox, FlaskConical, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/components/AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

const ago = (d: string | Date) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return "الآن";
  if (m < 60) return `${m}د`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}س` : `${Math.round(h / 24)}ي`;
};

// The verb decides the colour, so a column can be skimmed without reading it.
const KIND_TONE: Record<string, string> = {
  "ردّ": "border-r-primary", "صمت": "border-r-muted-foreground/30",
  "قال": "border-r-blue-500/50", "تلقّى": "border-r-blue-500/30",
  "سلّم": "border-r-purple-500/50", "استلم": "border-r-purple-500/30",
  "نبّه": "border-r-red-500/50", "مهمة دورية": "border-r-yellow-500/50",
  "قرّر الإرسال": "border-r-green-500/50", "أوقف المتابعة": "border-r-red-500/50", "أجّل": "border-r-yellow-500/50",
};

function Column({ c }: { c: any }) {
  const [open, setOpen] = useState(false);
  const shown = open ? c.timeline : c.timeline.slice(0, 6);
  const k = c.counts;

  return (
    <div className={cn(card, "flex flex-col min-w-[19rem] w-[19rem] shrink-0 max-h-[46rem]",
      !c.isActive && "opacity-55",
      c.kind === "manager" && "border-primary/40")}>

      {/* Who, and what they are on right now */}
      <div className="p-3.5 border-b border-card-border">
        <div className="flex items-start gap-2.5">
          <span className="text-xl leading-none mt-0.5">{c.avatar ?? "🙂"}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-sm">{c.name}</p>
              {c.kind === "manager" && <span className="text-[9px] px-1.5 rounded bg-primary/15 text-primary border border-primary/30">مدير</span>}
              {c.kind === "internal" && <span className="text-[9px] px-1.5 rounded border border-card-border text-muted-foreground">داخلي</span>}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{c.title}</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
          <Zap className="w-3 h-3 text-primary shrink-0" />
          <p className="text-[11px] truncate">{c.doingNow}</p>
        </div>
      </div>

      {/* The day in numbers */}
      <div className="px-3.5 py-2.5 border-b border-card-border flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {k.replied > 0 && <span className="text-foreground">{k.replied} رد</span>}
        {k.silent > 0 && <span>{k.silent} صمت</span>}
        {k.wins > 0 && <span className="text-green-400 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />{k.wins}</span>}
        {k.losses > 0 && <span className="text-red-400 flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" />{k.losses}</span>}
        {k.said > 0 && <span>{k.said} رسالة لزملائه</span>}
        {k.received > 0 && <span className="text-primary">{k.received} لم يقرأها</span>}
        {c.memory?.instruction > 0 && <span className="flex items-center gap-0.5"><Pin className="w-2.5 h-2.5" />{c.memory.instruction}</span>}
        {k.skills > 0 && <span className="flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />{k.skills}</span>}
      </div>

      {/* Conversations it is holding */}
      {c.conversations.length > 0 && (
        <div className="px-3.5 py-2 border-b border-card-border">
          <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <MessagesSquare className="w-2.5 h-2.5" /> يحاورهم الآن
          </p>
          <div className="flex flex-wrap gap-1">
            {c.conversations.map((p: string) => (
              <span key={p} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground" dir="ltr">{p}</span>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled work */}
      {c.routines.length > 0 && (
        <div className="px-3.5 py-2 border-b border-card-border space-y-1">
          {c.routines.map((r: any) => (
            <div key={r.id} className="flex items-center gap-1.5 text-[10px]">
              <Clock className={cn("w-2.5 h-2.5 shrink-0", r.isActive ? "text-primary" : "text-muted-foreground/40")} />
              <span className={cn("truncate", !r.isActive && "line-through text-muted-foreground/50")}>{r.name}</span>
              <span className="text-muted-foreground/60 mr-auto shrink-0">{r.when}</span>
            </div>
          ))}
        </div>
      )}

      {/* The day itself */}
      <div className="flex-1 overflow-y-auto">
        {c.timeline.length === 0 ? (
          <p className="p-5 text-[11px] text-muted-foreground text-center">لم يفعل شيئاً اليوم.</p>
        ) : (
          <div className="p-2.5 space-y-1.5">
            {shown.map((t: any, i: number) => (
              <div key={i} className={cn("border-r-2 pr-2 py-1", KIND_TONE[t.kind] ?? "border-r-card-border",
                t.tone === "good" && "bg-green-500/5", t.tone === "bad" && "bg-red-500/5", t.tone === "warn" && "bg-yellow-500/5")}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium">{t.kind}</span>
                  {t.phone && <span className="text-[9px] text-muted-foreground/70" dir="ltr">{t.phone}</span>}
                  <span className="text-[9px] text-muted-foreground/50 mr-auto">{ago(t.at)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 whitespace-pre-wrap">{t.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {c.timeline.length > 6 && (
        <button onClick={() => setOpen(!open)}
          className="px-3.5 py-2 border-t border-card-border text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1">
          {open ? <><ChevronUp className="w-3 h-3" /> أقل</> : <><ChevronDown className="w-3 h-3" /> كل الـ{c.timeline.length}</>}
        </button>
      )}
    </div>
  );
}

const VERDICT = {
  send: { icon: CheckCircle2, cls: "text-green-400",  label: "أرسل" },
  hold: { icon: PauseCircle,  cls: "text-yellow-400", label: "أجّل" },
  drop: { icon: XCircle,      cls: "text-red-400",    label: "أوقف" },
} as const;

export default function Board() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["board"], queryFn: () => api("/api/board"), refetchInterval: 30_000,
  });

  const runIntake = useMutation({
    mutationFn: () => api("/api/board/intake/run", { method: "POST" }),
    onSuccess: (d: any) => { toast.success(`سالم راجع ${d.considered} وأضاف ${d.queued}`); qc.invalidateQueries({ queryKey: ["board"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const runFollow = useMutation({
    mutationFn: () => api("/api/board/followup/run", { method: "POST" }),
    onSuccess: (d: any) => {
      toast.success(d.note ?? `خالد راجع ${d.decided.length} متابعة${d.dryRun ? " (تجربة)" : ""}`);
      qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setDry = useMutation({
    mutationFn: (dryRun: boolean) => api("/api/board/followup/dry-run", { method: "PATCH", body: JSON.stringify({ dryRun }) }),
    onSuccess: (_d, dryRun) => {
      toast[dryRun ? "success" : "warning"](dryRun ? "عاد لوضع التجربة" : "المتابعة تُرسل فعلياً الآن");
      qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const cols: any[] = data?.columns ?? [];
  const f = data?.followUp ?? {};
  const seg = data?.segments ?? { counts: {}, labels: {} };
  const fn = data?.funnel ?? null;
  const stageName = (n: number) => (fn?.byStage ?? []).find((s: any) => s.stage === n)?.name ?? `مرحلة ${n}`;
  // The card's columns hold a shop's facts now (see api-server lib/lead-card.ts): licence is how they want it.
  const MODE: Record<string, string> = { delivery: "توصيل", pickup: "استلام", dinein: "في المحل", booking: "حجز", queue: "دور", preorder: "طلب مسبق" };
  const factsOf = (c: any) => [
    c.licence ? MODE[c.licence] ?? c.licence : null,
    c.size, c.staff, c.taxStatus, c.activity, c.accountant, c.pain,
  ].filter(Boolean).join(" · ");

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">لوحة الفريق</h1>
          <p className="text-sm text-muted-foreground mt-1">
            كل موظف وما يفعله الآن، وحركته خلال اليوم، وكلامه مع زملائه.
          </p>
        </div>
        <Link href="/ops" className={ghost}><Radar className="w-3.5 h-3.5" /> غرفة العمليات</Link>
      </div>

      {/* The columns */}
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-6 px-6">
        {cols.map((c) => <Column key={c.id} c={c} />)}
      </div>

      {/* Where every lead is in the sale — from the cards, not from a feeling */}
      {fn && (
        <div className={cn(card, "p-4")}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-sm">قمع البيع — آخر ٣٠ يوماً</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                كل زبون له بطاقة تُكتب من كلامه هو: يبغى توصيل ولا حجز ولا دور، كم شخص، أي وقت، المناسبة والحساسية، وأي مرحلة بلغها. الموظف يقرأها قبل كل رد ولا يسأل عمّا فيها.
              </p>
            </div>
            <Link href="/inbox" className={ghost}><Inbox className="w-3.5 h-3.5" /> المحادثات</Link>
          </div>
          <div className="flex gap-2 overflow-x-auto mt-3">
            {(fn.byStage as any[]).map((s) => (
              <div key={s.stage} className={cn("rounded-lg border p-2.5 min-w-[6.5rem] shrink-0",
                s.n > 0 ? (s.stage >= 5 ? "border-primary/40 bg-primary/5" : "border-card-border") : "border-card-border opacity-50")}>
                <p className="text-[11px] text-muted-foreground">{s.stage} · {s.name}</p>
                <p className="text-lg font-bold leading-none mt-1">{s.n}</p>
              </div>
            ))}
          </div>

          {(fn.hot as any[])?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-primary" /> الأقرب إلى الإغلاق</p>
              <div className="divide-y divide-card-border rounded-lg border border-card-border">
                {(fn.hot as any[]).map((c) => (
                  <div key={c.phone} className="p-2.5 flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-mono" dir="ltr">{c.phone}</span>
                    <span className={cn("text-[10px] px-2 py-0.5 rounded border",
                      c.stage >= 7 ? "border-primary/40 text-primary" : c.stage === 6 ? "border-orange-500/40 text-orange-400" : "border-card-border text-muted-foreground")}>
                      {c.stage} · {stageName(c.stage)}{c.stage === 6 && c.objection ? ` — ${c.objection}` : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground min-w-0 flex-1 truncate">{factsOf(c) || "لا معلومات بعد"}</span>
                    {c.humanUntil && new Date(c.humanUntil).getTime() > Date.now() && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">يتولاه بشري</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60">{ago(c.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(fn.held as any[])?.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {fn.held.length} محادثة يتولاها شخص الآن — البوت والمتابعات صامتان فيها حتى ينتهي وقته أو يُعيدها من صفحة المحادثات.
            </p>
          )}
        </div>
      )}

      {/* The follow-up ladder */}
      <div className={cn(card, f.dryRun && "border-yellow-500/30")}>
        <div className="p-4 border-b border-card-border flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">سلّم المتابعة</p>
              {f.dryRun ? (
                <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-yellow-500/30 text-yellow-400">
                  <FlaskConical className="w-3 h-3" /> وضع التجربة — لا يُرسل شيء
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-primary/30 text-primary">
                  <Play className="w-3 h-3" /> يُرسل فعلياً
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              خالد يعرض كل متابعة على شمّة (هل تستحق؟) وفهد (هل الرقم يحتمل؟) قبل أن يقرّر. لفهد حق النقض.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => runIntake.mutate()} disabled={runIntake.isPending} className={ghost}>
              {runIntake.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Inbox className="w-3.5 h-3.5" />} شغّل سالم
            </button>
            <button onClick={() => runFollow.mutate()} disabled={runFollow.isPending} className={ghost}>
              {runFollow.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} شغّل خالد
            </button>
            <button onClick={() => setDry.mutate(!f.dryRun)} disabled={setDry.isPending || !f.active}
              className={cn(ghost, f.dryRun ? "border-primary/40 text-primary" : "border-yellow-500/40 text-yellow-400")}>
              {f.dryRun ? "فعّل الإرسال" : "أعِده للتجربة"}
            </button>
          </div>
        </div>

        {/* The rungs */}
        <div className="p-4 border-b border-card-border">
          <div className="flex gap-2 overflow-x-auto">
            {(f.byStep ?? []).map((s: any) => (
              <div key={s.step} className={cn("rounded-lg border p-2.5 min-w-[7.5rem] shrink-0",
                s.pending > 0 ? "border-primary/30 bg-primary/5" : "border-card-border")}>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold leading-none mt-1">{s.pending}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  منتظر{s.sent > 0 ? ` · ${s.sent} أُرسل` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* What they argued */}
        <div className="max-h-96 overflow-y-auto divide-y divide-card-border">
          {(f.deliberations ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              لم يُناقَش شيء بعد — اضغط «شغّل سالم» ليبني القائمة، ثم «شغّل خالد» ليراجعها.
            </p>
          ) : (
            (f.deliberations as any[]).map((d) => {
              const v = VERDICT[d.verdict as keyof typeof VERDICT] ?? VERDICT.hold;
              return (
                <div key={d.id} className="p-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <v.icon className={cn("w-3.5 h-3.5 shrink-0", v.cls)} />
                    <span className={cn("text-xs font-medium", v.cls)}>{v.label}</span>
                    <span className="text-xs" dir="ltr">{d.phone}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {seg.labels?.[d.segment] ?? d.segment} · فتح {d.opens}×
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 mr-auto">{ago(d.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{d.reason}</p>
                  {(d.managerView !== "—" || d.opsView !== "—") && (
                    <div className="mt-2 space-y-1">
                      {d.managerView !== "—" && (
                        <p className="text-[10px] text-muted-foreground"><span className="text-foreground">👩‍💼 شمّة:</span> {d.managerView}</p>
                      )}
                      {d.opsView !== "—" && (
                        <p className="text-[10px] text-muted-foreground"><span className="text-foreground">📡 فهد:</span> {d.opsView}</p>
                      )}
                    </div>
                  )}
                  {d.draft && (
                    <div className="mt-2 rounded-lg border border-card-border bg-muted/30 p-2.5">
                      <p className="text-[9px] text-muted-foreground mb-1">
                        {d.executed ? "أُرسلت:" : "كانت ستُرسل:"}
                      </p>
                      <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{d.draft}</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Where the queue comes from */}
      {Object.keys(seg.counts ?? {}).length > 0 && (
        <div className={cn(card, "p-4")}>
          <p className="font-semibold text-sm mb-3">تصنيف ريم — مصدر القائمة</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(seg.counts as Record<string, number>)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <div key={k} className={cn("rounded-lg border px-3 py-2",
                  k === "warm" || k === "curious" ? "border-primary/30 bg-primary/5" : "border-card-border")}>
                  <p className="text-base font-bold leading-none">{n}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{seg.labels?.[k] ?? k}</p>
                </div>
              ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            سالم يأخذ من «يقرأ ولا يرد» و«فتح الرسالة مرة» فقط. من وصلته ولم يفتحها لا يُطارَد — سبع رسائل لمن لم ينظر مرة واحدة تجلب شكوى لا عميلاً.
          </p>
        </div>
      )}
    </div>
  );
}
