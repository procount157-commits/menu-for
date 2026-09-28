import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Loader2, Wifi, WifiOff, Gauge, Users, Flame, Clock, ArrowLeftRight,
  ShieldCheck, ShieldAlert, ShieldX, Play, Send, Pause, RotateCcw,
  TrendingUp, TrendingDown, Brain, Pin, CircleDot, Settings2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "@/components/AgentPanel";
import { TelegramCard } from "@/components/TelegramCard";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

const LEVEL = {
  ok:       { icon: ShieldCheck, cls: "text-primary",    ring: "border-primary/30 bg-primary/5",       label: "مستقر" },
  warning:  { icon: ShieldAlert, cls: "text-yellow-400", ring: "border-yellow-500/30 bg-yellow-500/5", label: "تنبيه" },
  critical: { icon: ShieldX,     cls: "text-red-400",    ring: "border-red-500/30 bg-red-500/5",       label: "حرج" },
} as const;

const KIND = {
  handoff:   { label: "تسليم",  cls: "text-blue-300   border-blue-500/30   bg-blue-500/5" },
  directive: { label: "توجيه",  cls: "text-primary    border-primary/30    bg-primary/5" },
  alert:     { label: "تنبيه",  cls: "text-red-300    border-red-500/30    bg-red-500/5" },
  report:    { label: "تقرير",  cls: "text-muted-foreground border-card-border bg-muted/30" },
  question:  { label: "سؤال",   cls: "text-yellow-300 border-yellow-500/30 bg-yellow-500/5" },
  answer:    { label: "جواب",   cls: "text-green-300  border-green-500/30  bg-green-500/5" },
} as const;

const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} د`;
  const h = Math.round(m / 60);
  return h < 24 ? `منذ ${h} س` : `منذ ${Math.round(h / 24)} ي`;
};

function Stat({ icon: Icon, value, label, tone }: any) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className={cn("w-4 h-4 shrink-0", tone ?? "text-muted-foreground")} />
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

/** One employee, as a card in the org view. */
function AgentCard({ e, edges, team }: { e: any; edges: any[]; team: any[] }) {
  const out = edges.filter((x) => x.from === e.role);
  const inn = edges.filter((x) => x.to === e.role);
  const nameOf = (r: string) => team.find((t) => t.role === r)?.name ?? r;
  const total = e.wins + e.losses;

  return (
    <div className={cn(card, "p-4 flex flex-col gap-3",
      !e.isActive && "opacity-50",
      e.kind === "manager" && "border-primary/40")}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{e.avatar ?? "🙂"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm">{e.name}</p>
            {e.kind === "manager" && <span className="text-[10px] px-1.5 rounded bg-primary/15 text-primary border border-primary/30">مدير</span>}
            {e.kind === "internal" && <span className="text-[10px] px-1.5 rounded border border-card-border text-muted-foreground">داخلي</span>}
            {e.isActive
              ? <CircleDot className="w-3 h-3 text-primary" />
              : <span className="text-[10px] text-muted-foreground">موقوف</span>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{e.title}</p>
        </div>
      </div>

      {e.kind !== "internal" && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-base font-bold leading-none">{e.holding}</p>
            <p className="text-[10px] text-muted-foreground mt-1">محادثة معه</p>
          </div>
          <div>
            <p className="text-base font-bold leading-none">{e.replied24h}</p>
            <p className="text-[10px] text-muted-foreground mt-1">رد اليوم</p>
          </div>
          <div>
            <p className={cn("text-base font-bold leading-none",
              total === 0 ? "" : e.wins >= e.losses ? "text-green-400" : "text-red-400")}>
              {total === 0 ? "—" : `${Math.round((e.wins / total) * 100)}%`}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">نجاح</p>
          </div>
        </div>
      )}

      {/* What it carries from one conversation to the next. */}
      {(e.memory?.instruction || e.memory?.win || e.memory?.loss || e.routines > 0) && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {e.memory?.instruction > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-card-border text-muted-foreground">
              <Pin className="w-2.5 h-2.5" /> {e.memory.instruction} تعليمة
            </span>
          )}
          {e.memory?.win > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-green-500/25 text-green-400">
              <TrendingUp className="w-2.5 h-2.5" /> {e.memory.win}
            </span>
          )}
          {e.memory?.loss > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-500/25 text-red-400">
              <TrendingDown className="w-2.5 h-2.5" /> {e.memory.loss}
            </span>
          )}
          {e.routines > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-card-border text-muted-foreground">
              <Clock className="w-2.5 h-2.5" /> {e.routines} مهمة دورية
            </span>
          )}
        </div>
      )}

      {(out.length > 0 || inn.length > 0) && (
        <div className="pt-2 border-t border-card-border space-y-1">
          {out.map((x) => (
            <p key={`o${x.to}`} className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ArrowLeftRight className="w-2.5 h-2.5 shrink-0" /> سلّم {x.n} إلى {nameOf(x.to)}
            </p>
          ))}
          {inn.map((x) => (
            <p key={`i${x.from}`} className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ArrowLeftRight className="w-2.5 h-2.5 shrink-0" /> استلم {x.n} من {nameOf(x.from ?? "—")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentOps() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [to, setTo] = useState("");
  const [tuning, setTuning] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["ops"], queryFn: () => api("/api/ops"), refetchInterval: 30_000,
  });

  const check = useMutation({
    mutationFn: () => api("/api/ops/check", { method: "POST" }),
    onSuccess: (d: any) => {
      toast[d.level === "ok" ? "success" : d.level === "critical" ? "error" : "warning"](d.headline ?? d.body?.split("\n")[0]);
      qc.invalidateQueries({ queryKey: ["ops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({
    mutationFn: () => api("/api/ops/say", { method: "POST", body: JSON.stringify({ toRole: to || null, body: msg }) }),
    onSuccess: () => { setMsg(""); toast.success("وصلت"); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setControls = useMutation({
    mutationFn: (body: any) => api("/api/ops/controls", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { toast.success("تم"); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const release = useMutation({
    mutationFn: () => api("/api/ops/controls/release", { method: "POST" }),
    onSuccess: () => { toast.success("أُعيد التحكم للموظف"); qc.invalidateQueries({ queryKey: ["ops"] }); },
  });
  const ack = useMutation({
    mutationFn: (id: number) => api(`/api/ops/alerts/${id}/ack`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops"] }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const a = data?.account ?? {};
  const c = data?.controls ?? {};
  const team: any[] = data?.team ?? [];
  const staff = team.filter((t) => t.kind !== "internal");
  const internal = team.filter((t) => t.kind === "internal");
  const alerts: any[] = data?.alerts ?? [];
  const open = alerts.filter((x) => !x.acknowledged && x.level !== "ok");
  const quotaPct = a.dailyLimit > 0 ? Math.round((a.sentToday / a.dailyLimit) * 100) : 0;
  const throttled = c.throttle > 1 || c.held || c.dailyCeiling;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">غرفة العمليات</h1>
          <p className="text-sm text-muted-foreground mt-1">
            فريقك وهو يعمل: من يتولّى من، وماذا يقولون لبعضهم، وحالة الرقم.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/employees" className={ghost}><Settings2 className="w-3.5 h-3.5" /> تدريب الفريق</Link>
          <button onClick={() => check.mutate()} disabled={check.isPending} className={ghost}>
            {check.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            افحص الآن
          </button>
        </div>
      </div>

      {/* Account state */}
      <div className={cn(card, "p-4 grid grid-cols-2 md:grid-cols-5 gap-4")}>
        <Stat icon={a.connected ? Wifi : WifiOff} tone={a.connected ? "text-primary" : "text-red-400"}
              value={a.connected ? "متصل" : "منقطع"} label="واتساب" />
        <Stat icon={Gauge} tone={quotaPct >= 90 ? "text-red-400" : quotaPct >= 70 ? "text-yellow-400" : undefined}
              value={`${a.sentToday}/${a.dailyLimit}`} label={`حصة اليوم (${quotaPct}%)`} />
        <Stat icon={Users} value={a.leads ?? 0} label="عملاء" />
        <Stat icon={Flame} tone="text-orange-400" value={a.hotLeads ?? 0} label="مهتمون" />
        <Stat icon={Clock} value={a.pendingFollowUps ?? 0} label="متابعات منتظرة" />
      </div>

      {/* The composite risk — what فهد acts on */}
      {data?.risk && (() => {
        const r = data.risk;
        const tone = r.score < 20 ? "bg-primary" : r.score < 40 ? "bg-yellow-400" : r.score < 60 ? "bg-orange-400" : "bg-red-500";
        const text = r.score < 20 ? "text-primary" : r.score < 40 ? "text-yellow-400" : r.score < 60 ? "text-orange-400" : "text-red-400";
        return (
          <div className={cn(card, "p-4", r.score >= 40 && "border-orange-500/30")}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">مؤشر خطر الحظر</p>
                  <span className={cn("text-[11px] px-2 py-0.5 rounded border border-card-border", text)}>{r.levelAr}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  التسليم والفشل وطلبات الإيقاف والحظر المحتمل والتذبذب وعمر الرقم — مجموعة في رقم واحد. فهد يبطئ من ٢٠، ويقلّص الحصة من ٤٠، ويوقف عند ٨٠.
                </p>
              </div>
              <div className="text-end shrink-0">
                <p className={cn("text-3xl font-bold leading-none", text)}>{r.score}<span className="text-sm text-muted-foreground">/100</span></p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden" dir="ltr">
              <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(2, r.score)}%` }} />
            </div>
            {r.reasons?.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {r.reasons.map((x: string, i: number) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-2"><span className="text-foreground/40">•</span>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground">لا إشارة تستدعي القلق الآن.</p>
            )}
            {(r.throttle > 1 || r.ceilingFactor < 1 || r.holdMinutes > 0) && (
              <p className="mt-2 text-[11px]">
                <span className="text-muted-foreground">ردّ فهد على هذا المستوى: </span>
                {r.holdMinutes > 0 ? `إيقاف ${r.holdMinutes} دقيقة` : `إبطاء ${r.throttle}×`}
                {r.ceilingFactor < 1 && r.holdMinutes === 0 ? ` · الحصة ${Math.round(r.ceilingFactor * 100)}% من المسموح` : ""}
              </p>
            )}
          </div>
        );
      })()}

      {/* What the officer has done to the number right now */}
      <div className={cn(card, "p-4", throttled && "border-yellow-500/30 bg-yellow-500/5")}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">التحكم في الإرسال</p>
              <span className={cn("text-[11px] px-2 py-0.5 rounded border",
                c.setBy === "owner" ? "border-primary/30 text-primary" : "border-card-border text-muted-foreground")}>
                {c.setBy === "owner" ? "يدوي — منك" : "تلقائي — فهد"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {c.held
                ? `الإرسال موقوف حتى ${new Date(c.holdUntil).toLocaleTimeString("ar-AE", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" })}`
                : c.throttle > 1
                  ? `الإرسال أبطأ ${c.throttle}× من المعتاد`
                  : "الإرسال بالسرعة المحسوبة"}
              {c.dailyCeiling ? ` · سقف اليوم ${c.dailyCeiling} بدل ${a.warmupLimit}` : ""}
              {c.reason ? ` — ${c.reason}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.setBy === "owner" && (
              <button onClick={() => release.mutate()} className={ghost}>
                <RotateCcw className="w-3.5 h-3.5" /> أعِده لفهد
              </button>
            )}
            <button onClick={() => setTuning(!tuning)} className={ghost}>
              <Settings2 className="w-3.5 h-3.5" /> {tuning ? "إغلاق" : "تحكّم يدوي"}
            </button>
          </div>
        </div>

        {tuning && (
          <div className="mt-4 pt-4 border-t border-card-border flex flex-wrap items-end gap-3">
            <div className="w-36">
              <label className="text-xs font-semibold block mb-1.5">إبطاء الإرسال</label>
              <select defaultValue={String(c.throttle ?? 1)} className={input}
                      onChange={(e) => setControls.mutate({ throttle: Number(e.target.value) })}>
                <option value="1">عادي</option>
                <option value="2">أبطأ ٢×</option>
                <option value="3">أبطأ ٣×</option>
                <option value="5">أبطأ ٥×</option>
              </select>
            </div>
            <div className="w-36">
              <label className="text-xs font-semibold block mb-1.5">سقف اليوم</label>
              <input type="number" min={0} defaultValue={c.dailyCeiling ?? ""} placeholder={String(a.warmupLimit)}
                     className={input}
                     onBlur={(e) => setControls.mutate({ dailyCeiling: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <button onClick={() => setControls.mutate({ holdMinutes: c.held ? 0 : 60, reason: c.held ? null : "إيقاف يدوي" })}
                    className={cn(ghost, c.held ? "border-primary/40 text-primary" : "border-red-500/30 text-red-400")}>
              {c.held ? <><Play className="w-3.5 h-3.5" /> استأنف</> : <><Pause className="w-3.5 h-3.5" /> أوقف ساعة</>}
            </button>
            <p className="text-[11px] text-muted-foreground basis-full">
              لا يوجد خيار يجعل الإرسال أسرع — السرعة محسوبة أصلاً لتحقيق هدفك اليومي بأمان.
            </p>
          </div>
        )}
      </div>

      {/* Open alerts */}
      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((al) => {
            const l = LEVEL[al.level as keyof typeof LEVEL] ?? LEVEL.warning;
            return (
              <div key={al.id} className={cn("rounded-xl border p-4", l.ring)}>
                <div className="flex items-start gap-3">
                  <l.icon className={cn("w-5 h-5 shrink-0 mt-0.5", l.cls)} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{al.headline}</p>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">{al.body}</p>
                    {al.actions?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {al.actions.map((x: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{x}</span>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-2">{ago(al.createdAt)}</p>
                  </div>
                  <button onClick={() => ack.mutate(al.id)} className={cn(ghost, "shrink-0")} title="قرأته">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* The team */}
      <div>
        <p className="font-semibold text-sm mb-3">الفريق</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {staff.map((e) => <AgentCard key={e.id} e={e} edges={data?.edges ?? []} team={team} />)}
        </div>
        {internal.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {internal.map((e) => <AgentCard key={e.id} e={e} edges={data?.edges ?? []} team={team} />)}
          </div>
        )}
      </div>

      <TelegramCard />

      {/* What they say to each other */}
      <div className={card}>
        <div className="p-4 border-b border-card-border">
          <p className="font-semibold text-sm">ما يقولونه لبعضهم</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            ملاحظات داخلية — لا يراها أي عميل. اكتب هنا لتوجّه موظفاً، فيلتزم بما قلته في ردوده القادمة.
          </p>
        </div>

        <div className="p-4 border-b border-card-border flex gap-2 flex-wrap">
          <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(input, "w-40")}>
            <option value="">الفريق كله</option>
            {team.map((t) => <option key={t.role} value={t.role}>{t.avatar} {t.name}</option>)}
          </select>
          <input value={msg} onChange={(e) => setMsg(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) send.mutate(); }}
                 placeholder="لا تعرض أي خصم هذا الأسبوع" className={cn(input, "flex-1 min-w-[200px]")} />
          <button onClick={() => send.mutate()} disabled={!msg.trim() || send.isPending} className={ghost}>
            {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} أرسل
          </button>
        </div>

        <div className="max-h-[28rem] overflow-y-auto divide-y divide-card-border">
          {(data?.traffic ?? []).length === 0 && (
            <p className="p-6 text-sm text-muted-foreground text-center">لم يتبادلوا شيئاً بعد.</p>
          )}
          {(data?.traffic ?? []).map((m: any) => {
            const k = KIND[m.kind as keyof typeof KIND] ?? KIND.report;
            const mine = m.fromRole === "owner";
            return (
              <div key={m.id} className="p-3.5">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", k.cls)}>{k.label}</span>
                  <span className="text-xs font-medium">
                    {mine ? "أنت" : m.fromName}
                    {m.toName && <span className="text-muted-foreground"> ← {m.toName}</span>}
                    {!m.toName && <span className="text-muted-foreground"> ← الفريق</span>}
                  </span>
                  {m.phone && <span className="text-[10px] text-muted-foreground/70" dir="ltr">{m.phone}</span>}
                  <span className="text-[10px] text-muted-foreground/60 mr-auto">{ago(m.createdAt)}</span>
                  {!m.readAt && <span className="text-[10px] text-primary">لم تُقرأ</span>}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{m.body}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* What the routines concluded — the team's own suggestions */}
      {(data?.routineRuns ?? []).filter((r: any) => r.output).length > 0 && (
        <div className={card}>
          <div className="p-4 border-b border-card-border">
            <p className="font-semibold text-sm">ما اقترحه الفريق</p>
            <p className="text-xs text-muted-foreground mt-1">نتائج مهامهم الدورية — اقرأها وقرّر.</p>
          </div>
          <div className="divide-y divide-card-border">
            {(data.routineRuns as any[]).filter((r) => r.output).slice(0, 5).map((r) => (
              <div key={r.id} className="p-4">
                <p className="text-[10px] text-muted-foreground/60 mb-1.5">{ago(r.createdAt)}</p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{r.output}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
