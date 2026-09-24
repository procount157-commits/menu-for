import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Wifi, WifiOff, Loader2, RefreshCw, MessageSquare, VolumeX, BookOpen,
  ShieldCheck, ShieldAlert, ShieldX, Gauge, Users, Flame, Clock, Power,
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

export default function Employees() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["employees"],
    queryFn: () => api("/api/employees"),
    refetchInterval: 60_000,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api(`/api/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
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
  const hal  = data?.employees?.find((e: any) => e.role === "sales");
  const mark = data?.employees?.find((e: any) => e.role === "monitor");
  const report = mark?.lastReport;
  const lvl = LEVEL[(report?.level ?? "ok") as keyof typeof LEVEL];

  const quotaPct = s.dailyLimit > 0 ? Math.round((s.dailyUsed / s.dailyLimit) * 100) : 0;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">فريق البوتات</h1>
        <p className="text-sm text-muted-foreground mt-1">موظفوك الآليون وما أنجزوه</p>
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

      {/* هال */}
      {hal && (
        <div className={card}>
          <div className="p-4 flex items-start justify-between gap-3 border-b border-card-border">
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-2xl leading-none mt-0.5">{hal.avatar ?? "🤝"}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{hal.name}</p>
                  <span className={cn("px-2 py-0.5 rounded text-[11px] border",
                    hal.onDuty ? "bg-primary/15 text-primary border-primary/30"
                               : "border-card-border text-muted-foreground")}>
                    {hal.onDuty ? "على رأس العمل" : "متوقف"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{hal.title}</p>
              </div>
            </div>
            <button
              onClick={() => toggle.mutate({ id: hal.id, isActive: !hal.switchedOn })}
              disabled={toggle.isPending}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors shrink-0",
                hal.switchedOn ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                               : "border-primary/30 text-primary hover:bg-primary/10")}
            >
              <Power className="w-3.5 h-3.5" />
              {hal.switchedOn ? "إيقاف" : "تشغيل"}
            </button>
          </div>

          {hal.switchedOn && hal.stats.knowledgeEntries === 0 && (
            <div className="mx-4 mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-xs text-red-300 leading-relaxed">
                هال مُشغّل لكن لا يملك أي معلومة — سيصمت أمام كل سؤال.
                أضف معلوماتك من صفحة «معرفة البوت».
              </p>
            </div>
          )}

          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-card-border">
            <Stat icon={MessageSquare} tone="text-primary" value={hal.stats.replied24h} label="رد خلال 24 ساعة" />
            <Stat icon={VolumeX} value={hal.stats.silent24h} label="صمت (سؤال خارج معرفته)" />
            <Stat icon={MessageSquare} value={hal.stats.replied7d} label="رد هذا الأسبوع" />
            <Stat icon={BookOpen} value={hal.stats.knowledgeEntries} label="معلومة يعرفها" />
          </div>

          {hal.knowledgeGaps?.length > 0 && (
            <div className="p-4 border-b border-card-border">
              <p className="text-xs font-semibold mb-2">أسئلة صمت عنها — أضفها لمعرفته</p>
              <div className="space-y-1.5">
                {hal.knowledgeGaps.map((g: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/60 shrink-0">{g.n}×</span>
                    <span className="text-muted-foreground truncate">«{g.incoming}»</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hal.recentReplies?.length > 0 && (
            <div className="p-4">
              <p className="text-xs font-semibold mb-2">آخر ردوده</p>
              <div className="space-y-2.5">
                {hal.recentReplies.map((r: any, i: number) => (
                  <div key={i} className="text-xs border-r-2 border-primary/30 pr-2.5">
                    <p className="text-muted-foreground">«{r.incoming}»</p>
                    <p className="text-foreground mt-0.5 leading-relaxed">{r.reply}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* مارك */}
      {mark && (
        <div className={card}>
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
      )}
    </div>
  );
}
