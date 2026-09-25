import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Wifi, WifiOff, Loader2, RefreshCw, MessageSquare, VolumeX, BookOpen,
  ShieldCheck, ShieldAlert, ShieldX, Gauge, Users, Flame, Clock, Power,
  UserPlus, Trash2, ArrowLeftRight, Save, Pencil, MessagesSquare, X,
} from "lucide-react";
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

const card = "bg-card border border-card-border rounded-xl";
const LEVEL = {
  ok:       { icon: ShieldCheck, cls: "text-primary",     label: "سليم",  ring: "border-primary/30 bg-primary/5" },
  warning:  { icon: ShieldAlert, cls: "text-yellow-400",  label: "تنبيه", ring: "border-yellow-500/30 bg-yellow-500/5" },
  critical: { icon: ShieldX,     cls: "text-red-400",     label: "حرج",   ring: "border-red-500/30 bg-red-500/5" },
} as const;

// The intents an employee can be put in charge of. The labels are what the
// owner reads; the keys are what the classifier produces.
const SPECIALTIES: Array<{ key: string; label: string }> = [
  { key: "interested",     label: "مهتم بالشراء" },
  { key: "question",       label: "سؤال" },
  { key: "greeting",       label: "ترحيب" },
  { key: "unclear",        label: "غير واضح" },
  { key: "complaint",      label: "شكوى" },
  { key: "not_interested", label: "غير مهتم" },
];
const specialtyLabel = (k: string) => SPECIALTIES.find((s) => s.key === k)?.label ?? k;

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

const input = "w-full bg-input border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";

/** The persona and routing editor for one employee. */
function PersonaEditor({ e, onSave, saving }: { e: any; onSave: (v: any) => void; saving: boolean }) {
  const [persona, setPersona] = useState(e.persona ?? "");
  const [specialties, setSpecialties] = useState<string[]>(e.specialties ?? []);
  const [priority, setPriority] = useState(String(e.priority ?? 100));

  const dirty = persona !== (e.persona ?? "")
    || priority !== String(e.priority ?? 100)
    || JSON.stringify([...specialties].sort()) !== JSON.stringify([...(e.specialties ?? [])].sort());

  return (
    <div className="p-4 space-y-4 border-b border-card-border bg-muted/20">
      <div>
        <label className="text-xs font-semibold block mb-1.5">شخصيته</label>
        <textarea
          value={persona} onChange={(ev) => setPersona(ev.target.value)} rows={3}
          placeholder="كيف يتكلم، وما الذي يميّزه — مثال: هادئ ومتعاطف، يستمع للشكوى كاملةً قبل أن يرد، ولا يبرّر."
          className={cn(input, "resize-y leading-relaxed")}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          يُسلَّم للبوت كما كتبته. اكتبه كأنك تصف موظفاً حقيقياً لمن سيدرّبه.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold block mb-1.5">الرسائل التي تصله</label>
        <div className="flex flex-wrap gap-1.5">
          {SPECIALTIES.map((s) => {
            const on = specialties.includes(s.key);
            return (
              <button
                key={s.key} type="button"
                onClick={() => setSpecialties(on ? specialties.filter((x) => x !== s.key) : [...specialties, s.key])}
                className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
                  on ? "bg-primary/15 text-primary border-primary/30" : "border-card-border text-muted-foreground hover:border-primary/40")}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {specialties.length === 0
            ? "لا شيء محدَّد — سيستلم ما لم يطالب به غيره فقط."
            : "المحادثة تنتقل إليه عند ورود هذه الأنواع، حتى لو كان زميله يحاور العميل."}
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="w-32">
          <label className="text-xs font-semibold block mb-1.5">الأولوية</label>
          <input type="number" min={1} max={999} value={priority}
                 onChange={(ev) => setPriority(ev.target.value)} className={input} />
          <p className="text-[11px] text-muted-foreground mt-1">الأصغر يفوز عند التنازع</p>
        </div>
        <button
          onClick={() => onSave({ persona, specialties, priority: Number(priority) })}
          disabled={!dirty || saving}
          className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors",
            dirty ? "border-primary/40 text-primary hover:bg-primary/10" : "border-card-border text-muted-foreground/50 cursor-not-allowed")}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          حفظ
        </button>
      </div>
    </div>
  );
}

function HireForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", role: "", title: "", avatar: "🙂", persona: "", specialties: [] as string[] });

  const hire = useMutation({
    mutationFn: () => api("/api/employees", { method: "POST", body: JSON.stringify({ ...f, priority: 50 }) }),
    onSuccess: () => { toast.success(`${f.name} عُيِّن`); qc.invalidateQueries({ queryKey: ["employees"] }); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={cn(card, "p-4 space-y-4 border-primary/30")}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">تعيين موظف جديد</p>
        <button onClick={onDone} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-semibold block mb-1.5">الاسم</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ليلى" className={input} />
        </div>
        <div>
          <label className="text-xs font-semibold block mb-1.5">المسمّى</label>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="موظفة التحصيل" className={input} />
        </div>
        <div>
          <label className="text-xs font-semibold block mb-1.5">المعرّف</label>
          <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="collections" dir="ltr" className={input} />
        </div>
        <div>
          <label className="text-xs font-semibold block mb-1.5">الرمز</label>
          <input value={f.avatar} onChange={(e) => setF({ ...f, avatar: e.target.value })} className={cn(input, "text-center text-lg")} />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold block mb-1.5">شخصيته</label>
        <textarea value={f.persona} onChange={(e) => setF({ ...f, persona: e.target.value })} rows={3}
                  placeholder="كيف يتكلم وما الذي يميّزه" className={cn(input, "resize-y leading-relaxed")} />
      </div>

      <div>
        <label className="text-xs font-semibold block mb-1.5">الرسائل التي تصله</label>
        <div className="flex flex-wrap gap-1.5">
          {SPECIALTIES.map((s) => {
            const on = f.specialties.includes(s.key);
            return (
              <button key={s.key} type="button"
                onClick={() => setF({ ...f, specialties: on ? f.specialties.filter((x) => x !== s.key) : [...f.specialties, s.key] })}
                className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
                  on ? "bg-primary/15 text-primary border-primary/30" : "border-card-border text-muted-foreground hover:border-primary/40")}
              >{s.label}</button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => hire.mutate()}
        disabled={hire.isPending || !f.name.trim() || !f.role.trim()}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
      >
        {hire.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        تعيين
      </button>
    </div>
  );
}

export default function Employees() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [hiring, setHiring] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["employees"],
    queryFn: () => api("/api/employees"),
    refetchInterval: 60_000,
  });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: any) =>
      api(`/api/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const dismiss = useMutation({
    mutationFn: (id: number) => api(`/api/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("أُنهيت خدمته"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runCheck = useMutation({
    mutationFn: () => api("/api/employees/monitor/run", { method: "POST" }),
    onSuccess: (d: any) => {
      toast[d.level === "ok" ? "success" : d.level === "critical" ? "error" : "warning"](d.summary);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const s = data?.shared ?? {};
  const team: any[] = data?.employees ?? [];
  const staff = team.filter((e) => e.kind !== "internal");
  const internal = team.filter((e) => e.kind === "internal");
  const quotaPct = s.dailyLimit > 0 ? Math.round((s.dailyUsed / s.dailyLimit) * 100) : 0;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">فريق البوتات</h1>
          <p className="text-sm text-muted-foreground mt-1">
            موظفوك الآليون. كل واحد له شخصيته، ويسلّم المحادثة لزميله حين تخرج عن اختصاصه.
          </p>
        </div>
        {!hiring && (
          <button onClick={() => setHiring(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/40 text-primary text-sm hover:bg-primary/10 shrink-0">
            <UserPlus className="w-4 h-4" /> تعيين موظف
          </button>
        )}
      </div>

      {/* Shared state */}
      <div className={cn(card, "p-4 grid grid-cols-2 md:grid-cols-4 gap-4")}>
        <Stat
          icon={s.whatsappConnected ? Wifi : WifiOff}
          tone={s.whatsappConnected ? "text-primary" : "text-red-400"}
          value={s.whatsappConnected ? "متصل" : "منقطع"}
          label="واتساب"
        />
        <Stat
          icon={Gauge}
          tone={quotaPct >= 90 ? "text-red-400" : quotaPct >= 70 ? "text-yellow-400" : "text-muted-foreground"}
          value={`${s.dailyUsed}/${s.dailyLimit}`}
          label={`الحصة اليوم (${quotaPct}%)`}
        />
        <Stat icon={Users} value={s.leads ?? 0} label="عملاء" />
        <Stat icon={Flame} tone="text-orange-400" value={s.hotLeads ?? 0} label="مهتمون" />
      </div>

      {hiring && <HireForm onDone={() => setHiring(false)} />}

      {/* Customer-facing staff */}
      {staff.map((e) => (
        <div key={e.id} className={card}>
          <div className="p-4 flex items-start justify-between gap-3 border-b border-card-border">
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-2xl leading-none mt-0.5">{e.avatar ?? "🙂"}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{e.name}</p>
                  <span className={cn("px-2 py-0.5 rounded text-[11px] border",
                    e.onDuty ? "bg-primary/15 text-primary border-primary/30"
                             : "border-card-border text-muted-foreground")}>
                    {e.onDuty ? "على رأس العمل" : "متوقف"}
                  </span>
                  {e.holdingConversations > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-card-border text-muted-foreground">
                      <MessagesSquare className="w-3 h-3" /> {e.holdingConversations} محادثة معه
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{e.title}</p>
                {e.specialties?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {e.specialties.map((k: string) => (
                      <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                        {specialtyLabel(k)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setEditing(editing === e.id ? null : e.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-card-border hover:border-primary/50"
              >
                <Pencil className="w-3.5 h-3.5" /> {editing === e.id ? "إغلاق" : "الشخصية"}
              </button>
              <button
                onClick={() => patch.mutate({ id: e.id, isActive: !e.switchedOn })}
                disabled={patch.isPending}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  e.switchedOn ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                               : "border-primary/30 text-primary hover:bg-primary/10")}
              >
                <Power className="w-3.5 h-3.5" />
                {e.switchedOn ? "إيقاف" : "تشغيل"}
              </button>
              {e.role !== "sales" && (
                <button
                  onClick={() => { if (confirm(`إنهاء خدمة ${e.name}؟ المحادثات التي يحملها ستُوزَّع من جديد.`)) dismiss.mutate(e.id); }}
                  disabled={dismiss.isPending}
                  className="p-1.5 rounded-lg border border-card-border text-muted-foreground hover:text-red-400 hover:border-red-500/30"
                  title="إنهاء الخدمة"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {editing === e.id && (
            <PersonaEditor
              e={e} saving={patch.isPending}
              onSave={(v) => patch.mutate({ id: e.id, ...v }, { onSuccess: () => toast.success("حُفظت شخصيته") })}
            />
          )}

          {e.switchedOn && e.stats?.knowledgeEntries === 0 && (
            <div className="mx-4 mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-xs text-red-300 leading-relaxed">
                {e.name} مُشغّل لكن لا يملك أي معلومة — سيصمت أمام كل سؤال.
                أضف معلوماتك من صفحة «معرفة البوت».
              </p>
            </div>
          )}

          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-card-border">
            <Stat icon={MessageSquare} tone="text-primary" value={e.stats?.replied24h ?? 0} label="رد خلال 24 ساعة" />
            <Stat icon={VolumeX} value={e.stats?.silent24h ?? 0} label="صمت" />
            <Stat icon={MessageSquare} value={e.stats?.replied7d ?? 0} label="ردود الفريق هذا الأسبوع" />
            <Stat icon={BookOpen} value={e.stats?.knowledgeEntries ?? 0} label="معلومة يعرفها" />
          </div>

          {(e.handedOut?.length > 0 || e.handedIn?.length > 0) && (
            <div className="px-4 py-3 border-b border-card-border flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              {e.handedOut?.map((h: any) => (
                <span key={`o${h.to}`} className="flex items-center gap-1">
                  <ArrowLeftRight className="w-3 h-3" />
                  سلّم {h.n} محادثة إلى {team.find((t) => t.role === h.to)?.name ?? h.to}
                </span>
              ))}
              {e.handedIn?.map((h: any) => (
                <span key={`i${h.from}`} className="flex items-center gap-1">
                  <ArrowLeftRight className="w-3 h-3" />
                  استلم {h.n} من {team.find((t) => t.role === h.from)?.name ?? h.from}
                </span>
              ))}
            </div>
          )}

          {e.knowledgeGaps?.length > 0 && (
            <div className="p-4 border-b border-card-border">
              <p className="text-xs font-semibold mb-2">أسئلة صمت عنها — أضفها لمعرفته</p>
              <div className="space-y-1.5">
                {e.knowledgeGaps.map((g: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/60 shrink-0">{g.n}×</span>
                    <span className="text-muted-foreground truncate">«{g.incoming}»</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {e.recentReplies?.length > 0 && (
            <div className="p-4">
              <p className="text-xs font-semibold mb-2">آخر الردود</p>
              <div className="space-y-2.5">
                {e.recentReplies.map((r: any, i: number) => (
                  <div key={i} className="text-xs border-r-2 border-primary/30 pr-2.5">
                    <p className="text-muted-foreground">«{r.incoming}»</p>
                    <p className="text-foreground mt-0.5 leading-relaxed">{r.reply}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Handoffs between them */}
      {data?.recentHandoffs?.length > 0 && (
        <div className={card}>
          <div className="p-4 border-b border-card-border">
            <p className="font-semibold text-sm">آخر التسليمات بين الموظفين</p>
          </div>
          <div className="p-4 space-y-2">
            {data.recentHandoffs.map((h: any) => (
              <div key={h.id} className="flex items-center gap-2 text-xs flex-wrap">
                <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground" dir="ltr">{h.phone}</span>
                <span>
                  {team.find((t) => t.role === h.fromRole)?.name ?? h.fromRole ?? "—"}
                  {" → "}
                  <span className="text-primary">{team.find((t) => t.role === h.toRole)?.name ?? h.toRole}</span>
                </span>
                <span className="text-muted-foreground">({h.reason})</span>
                <span className="text-muted-foreground/60 mr-auto">
                  {new Date(h.createdAt).toLocaleString("ar-AE", { timeZone: "Asia/Dubai", dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Internal staff — the monitor */}
      {internal.map((mark) => {
        const report = mark.lastReport;
        const lvl = LEVEL[(report?.level ?? "ok") as keyof typeof LEVEL];
        return (
          <div key={mark.id} className={card}>
            <div className="p-4 flex items-start justify-between gap-3 border-b border-card-border">
              <div className="flex items-start gap-3 min-w-0">
                <span className="text-2xl leading-none mt-0.5">{mark.avatar ?? "🛡️"}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{mark.name}</p>
                    <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border", lvl.ring, lvl.cls)}>
                      <lvl.icon className="w-3 h-3" /> {lvl.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {mark.title} · كل {mark.intervalMinutes} دقيقة
                    {mark.nextCheckMinutes !== null && ` · التالي بعد ${mark.nextCheckMinutes} د`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => runCheck.mutate()}
                disabled={runCheck.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs hover:border-primary/50 shrink-0"
              >
                {runCheck.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                افحص الآن
              </button>
            </div>

            {!report ? (
              <p className="p-6 text-sm text-muted-foreground text-center">لم يجرِ فحصاً بعد — انتظر دقيقة أو اضغط «افحص الآن»</p>
            ) : (
              <div className="p-4 space-y-2.5">
                {(report.findings ?? []).map((f: any, i: number) => {
                  const fl = LEVEL[f.level as keyof typeof LEVEL];
                  return (
                    <div key={i} className={cn("rounded-lg border p-3", fl.ring)}>
                      <div className="flex items-start gap-2">
                        <fl.icon className={cn("w-4 h-4 shrink-0 mt-0.5", fl.cls)} />
                        <div className="min-w-0">
                          <p className="text-sm leading-relaxed">{f.message}</p>
                          {f.action && (
                            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">← {f.action}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
                  <Clock className="w-3 h-3" />
                  آخر فحص: {new Date(report.createdAt).toLocaleString("ar-AE", { timeZone: "Asia/Dubai" })}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
