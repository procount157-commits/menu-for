import { useState } from "react";
import { useGetWhatsappStatus } from "@workspace/api-client-react";
import {
  Settings2, Wifi, WifiOff, Loader2, RefreshCw, Trash2, QrCode,
  CheckCircle2, XCircle, AlertTriangle, Zap, BarChart3, Clock,
  Shield, Activity, SlidersHorizontal, Antenna,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Utility ───────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium", mono && "font-mono text-xs bg-muted px-1.5 py-0.5 rounded")}>
        {value}
      </span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, className }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card border border-border rounded-xl p-5", className)}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── WA Connection Panel ───────────────────────────────────────────────────────
function WaConnectionPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, unknown>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status, refetch } = useGetWhatsappStatus({ query: { refetchInterval: 5000 } as any });

  // Fetch health data (no generated hook — call directly)
  useState(() => {
    const load = () => fetch("/api/whatsapp/health", { credentials: "include" }).then(r => r.json()).then(setHealth).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  });

  const connected    = status?.connected;
  const waStatus     = status?.status as string;
  const reconnects   = health?.reconnectCount as number ?? 0;
  const uptimeSec    = health?.uptimeSeconds  as number ?? 0;
  const uptimeMin    = Math.floor(uptimeSec / 60);
  const uptimeHours  = Math.floor(uptimeMin / 60);
  const uptimeStr    = uptimeHours > 0 ? `${uptimeHours}س ${uptimeMin % 60}د` : `${uptimeMin}د`;

  const lastEvents: Array<{ event: string; createdAt: string }> = (health?.recentEvents as Array<{ event: string; createdAt: string }>) ?? [];

  const call = async (endpoint: string, label: string) => {
    setBusy(endpoint);
    try {
      const res = await fetch(`/api/whatsapp/${endpoint}`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast.success(label);
        setTimeout(() => refetch(), 2500);
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error((body as any)?.error ?? "فشل الطلب");
      }
    } catch {
      toast.error("تعذّر الوصول للخادم");
    } finally {
      setBusy(null);
    }
  };

  const statusColor =
    connected           ? "text-green-400"  :
    waStatus === "reconnecting" ? "text-orange-400" :
    waStatus === "qr_ready"     ? "text-yellow-400" :
    waStatus === "connecting"   ? "text-yellow-400" :
    "text-red-400";

  const statusLabel =
    connected           ? "متصل"            :
    waStatus === "reconnecting" ? "يُعيد الاتصال..." :
    waStatus === "qr_ready"     ? "في انتظار مسح QR" :
    waStatus === "connecting"   ? "جاري الاتصال..."  :
    "غير متصل";

  return (
    <SectionCard title="حالة اتصال واتساب" icon={Wifi}>
      {/* Status badge */}
      <div className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold mb-4",
        connected           ? "bg-green-500/10 border border-green-500/20"  :
        waStatus === "reconnecting" ? "bg-orange-500/10 border border-orange-500/20" :
        waStatus === "qr_ready"     ? "bg-yellow-500/10 border border-yellow-500/20" :
        "bg-red-500/10 border border-red-500/20"
      )}>
        {waStatus === "connecting" || waStatus === "reconnecting"
          ? <Loader2 className={cn("w-4 h-4 animate-spin", statusColor)} />
          : connected
            ? <Wifi className="w-4 h-4 text-green-400" />
            : <WifiOff className={cn("w-4 h-4", statusColor)} />
        }
        <span className={statusColor}>{statusLabel}</span>
        {status?.phone && <span className="text-muted-foreground text-xs font-normal ms-auto" dir="ltr">{status.phone}</span>}
      </div>

      {/* Stats */}
      <div className="space-y-0 mb-4">
        <InfoRow label="إعادات الاتصال (الجلسة)" value={reconnects} />
        {uptimeSec > 0 && <InfoRow label="مدة التشغيل" value={uptimeStr} />}
        {waStatus === "qr_ready" && (
          <div className="flex items-start gap-2 mt-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-300">
              واتساب يطلب مسح QR. اذهب إلى <strong>ربط الواتساب</strong> وامسح الرمز لاستعادة الاتصال.
            </p>
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => call("auto-heal", "جاري الإصلاح التلقائي...")}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 transition-all"
        >
          {busy === "auto-heal" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          إصلاح تلقائي
        </button>

        <button
          onClick={() => call("connect", "جاري إعادة الاتصال...")}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 transition-all"
        >
          {busy === "connect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          إعادة اتصال
        </button>

        <button
          onClick={() => call("logout", "تم قطع الاتصال — امسح QR لإعادة الربط")}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-orange-600/20 text-orange-400 border border-orange-600/30 hover:bg-orange-600/30 disabled:opacity-60 transition-all"
        >
          {busy === "logout" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
          QR جديد
        </button>

        <button
          onClick={() => {
            if (!confirm("سيُمسح كل شيء ويلزم مسح QR جديد. هل أنت متأكد؟")) return;
            call("reset-session", "تم مسح الجلسة — امسح QR الجديد");
          }}
          disabled={!!busy}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-600/15 text-red-400 border border-red-600/25 hover:bg-red-600/25 disabled:opacity-60 transition-all"
        >
          {busy === "reset-session" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          مسح الجلسة
        </button>
      </div>

      {/* Legend */}
      <div className="mt-3 p-3 bg-muted/30 rounded-lg text-[11px] text-muted-foreground space-y-1">
        <p><span className="text-primary font-semibold">إصلاح تلقائي</span> — يشخّص الحالة ويختار الحل المناسب تلقائياً (الأسرع)</p>
        <p><span className="text-blue-400 font-semibold">إعادة اتصال</span> — يعيد تهيئة الاتصال دون مسح الجلسة</p>
        <p><span className="text-orange-400 font-semibold">QR جديد</span> — يقطع الاتصال الحالي ويعرض رمز QR جديد</p>
        <p><span className="text-red-400 font-semibold">مسح الجلسة</span> — يحذف كل بيانات الجلسة (آخر ملاذ)</p>
      </div>

      {/* Recent events */}
      {lastEvents.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground mb-2 font-medium">آخر أحداث الاتصال</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {lastEvents.slice(0, 8).map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/30">
                <span className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  ev.event === "connected"    ? "bg-green-400" :
                  ev.event === "logged_out"   ? "bg-red-400"   :
                  ev.event === "qr_ready"     ? "bg-yellow-400" :
                  "bg-orange-400"
                )} />
                <span className="flex-1 text-muted-foreground">{
                  ev.event === "connected"    ? "اتصل ✓"           :
                  ev.event === "logged_out"   ? "انقطع / logout"   :
                  ev.event === "qr_ready"     ? "QR ظهر"           :
                  ev.event === "reconnecting" ? "يُعيد الاتصال..."  :
                  ev.event
                }</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0" dir="ltr">
                  {new Date(ev.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Counter Sync Panel ────────────────────────────────────────────────────────
function CounterSyncPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fixed: number; total: number } | null>(null);

  const handleSync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/campaigns/sync-counts", { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        if (data.fixed > 0) toast.success(`تم إصلاح عدادات ${data.fixed} حملة`);
        else toast.success("كل العدادات دقيقة — لا يوجد انحراف");
      } else {
        toast.error("فشل المزامنة");
      }
    } catch {
      toast.error("تعذّر الوصول للخادم");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="إصلاح عدادات الحملات" icon={BarChart3}>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        إذا ظهر عدد الإرسال 0 أو خاطئاً، اضغط هنا لمزامنة العدادات مع السجلات الحقيقية في قاعدة البيانات.
        يعمل هذا الإصلاح أيضاً تلقائياً في كل مرة تفتح فيها تفاصيل الحملة.
      </p>

      {result && (
        <div className={cn(
          "flex items-center gap-2 p-3 rounded-lg text-sm mb-4",
          result.fixed > 0 ? "bg-primary/10 text-primary border border-primary/20" : "bg-green-500/10 text-green-400 border border-green-500/20"
        )}>
          {result.fixed > 0
            ? <><AlertTriangle className="w-4 h-4" /><span>تم إصلاح <strong>{result.fixed}</strong> من <strong>{result.total}</strong> حملة</span></>
            : <><CheckCircle2 className="w-4 h-4" /><span>كل {result.total} حملة لديها عدادات دقيقة</span></>
          }
        </div>
      )}

      <button
        onClick={handleSync}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 transition-all"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {busy ? "جاري المزامنة..." : "مزامنة العدادات الآن"}
      </button>
    </SectionCard>
  );
}

// ── System Config Panel ───────────────────────────────────────────────────────
function SystemConfigPanel() {
  const [data, setData] = useState<{
    config?: Record<string, unknown>;
    campaigns?: { runningCount: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    fetch("/api/settings", { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  });

  const cfg = data?.config;

  return (
    <SectionCard title="إعدادات محرك الإرسال" icon={SlidersHorizontal}>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>جاري التحميل...</span>
        </div>
      ) : cfg ? (
        <div className="space-y-0">
          <InfoRow label="تأخير الإرسال (أدنى)" value={`${cfg.sendDelayMinSec}ث`} />
          <InfoRow label="تأخير الإرسال (أقصى)" value={`${cfg.sendDelayMaxSec}ث`} />
          <InfoRow label="نافذة الإرسال" value={`${cfg.timeGateStartHour}:00 — ${cfg.timeGateEndHour}:00`} />
          <InfoRow label="استراحة خفيفة كل" value={`${cfg.microBreakEvery} رسائل`} />
          <InfoRow label="استراحة طويلة كل" value={`${cfg.longBreakEvery} رسائل`} />
          <InfoRow label="حد الإرسال اليومي (أقصى)" value={`${cfg.dailyLimitMax?.toLocaleString()} رسالة`} />
          <InfoRow label="حد الإرسال الأول (warmup)" value={`${cfg.warmupDay0Limit} رسالة`} />
          <InfoRow label="نمو الـ warmup يومياً" value={`×${cfg.warmupDailyGrowth}`} />
          <InfoRow label="تعثّر الحملة بعد" value={`${cfg.stuckThresholdMin} دقيقة بلا تقدّم`} />
          {data?.campaigns && <InfoRow label="حملات تعمل الآن" value={data.campaigns.runningCount} />}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">تعذّر تحميل الإعدادات</p>
      )}
      <div className="mt-3 p-3 bg-muted/30 rounded-lg text-[11px] text-muted-foreground">
        هذه الإعدادات مضبوطة للحدّ الأدنى من خطر الحظر مع أقصى سرعة ممكنة آمنة.
      </div>
    </SectionCard>
  );
}

// ── Engine Status Panel ───────────────────────────────────────────────────────
function EngineStatusPanel() {
  const [data, setData] = useState<{
    activeLoops: Array<{
      campaignId: number;
      running: boolean;
      contactIndex: number;
      consecutiveWaFailures: number;
      idleSecs: number;
      stuckWarning: boolean;
    }>;
    dbRunning: Array<{ id: number; name: string; sentCount: number; totalCount: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns/engine-status", { credentials: "include" });
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  };

  return (
    <SectionCard title="محرك الحملات" icon={Activity}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">حالة الحملات النشطة في الذاكرة</p>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-primary hover:bg-primary/10 transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          تحديث
        </button>
      </div>

      {!data ? (
        <button
          onClick={refresh}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs text-muted-foreground border border-border hover:border-primary/30 hover:text-primary transition-colors"
        >
          <Activity className="w-4 h-4" />
          عرض حالة المحرك
        </button>
      ) : data.activeLoops.length === 0 ? (
        <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
          <XCircle className="w-4 h-4" />
          لا توجد حلقات نشطة في الذاكرة حالياً
        </div>
      ) : (
        <div className="space-y-2">
          {data.activeLoops.map((loop) => {
            const dbCamp = data.dbRunning.find((c) => c.id === loop.campaignId);
            return (
              <div key={loop.campaignId} className={cn(
                "p-3 rounded-lg border text-xs space-y-1",
                loop.stuckWarning ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/20"
              )}>
                <div className="flex items-center gap-2">
                  {loop.running
                    ? <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  }
                  <span className="font-semibold text-foreground">
                    {dbCamp?.name ?? `حملة #${loop.campaignId}`}
                  </span>
                  {loop.stuckWarning && <span className="ms-auto text-red-400 text-[10px]">⚠ متعثّر</span>}
                </div>
                <div className="flex gap-3 text-muted-foreground">
                  <span>جهة {loop.contactIndex}</span>
                  <span>خاملة {loop.idleSecs}ث</span>
                  {loop.consecutiveWaFailures > 0 && <span className="text-orange-400">انقطاعات: {loop.consecutiveWaFailures}</span>}
                </div>
                {dbCamp && (
                  <div className="mt-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>أُرسل: {dbCamp.sentCount}</span>
                      <span>من: {dbCamp.totalCount}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1">
                      <div
                        className="bg-primary h-1 rounded-full transition-all"
                        style={{ width: `${dbCamp.totalCount > 0 ? Math.min(100, (dbCamp.sentCount / dbCamp.totalCount) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function Settings() {
  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Settings2 className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">الإعدادات والتشخيص</h1>
          <p className="text-xs text-muted-foreground mt-0.5">إدارة الاتصال وإصلاح مشاكل الإرسال</p>
        </div>
      </div>

      {/* Quick status strip */}
      <QuickStatusStrip />

      {/* Grid layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WaConnectionPanel />
        <div className="space-y-5">
          <CounterSyncPanel />
          <EngineStatusPanel />
        </div>
      </div>

      <SystemConfigPanel />
    </div>
  );
}

// ── Quick status strip ────────────────────────────────────────────────────────
function QuickStatusStrip() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status } = useGetWhatsappStatus({ query: { refetchInterval: 5000 } as any });
  const connected = status?.connected;
  const waStatus  = status?.status as string;

  const items = [
    {
      icon: connected ? Wifi : WifiOff,
      label: connected ? "واتساب متصل" : waStatus === "qr_ready" ? "بانتظار QR" : waStatus === "reconnecting" ? "يُعيد الاتصال" : "غير متصل",
      color: connected ? "text-green-400" : waStatus === "reconnecting" ? "text-orange-400" : "text-red-400",
      bg:    connected ? "bg-green-500/10 border-green-500/20" : waStatus === "reconnecting" ? "bg-orange-500/10 border-orange-500/20" : "bg-red-500/10 border-red-500/20",
    },
    {
      icon: Shield,
      label: "إصلاح تلقائي للعدادات",
      color: "text-primary",
      bg:    "bg-primary/10 border-primary/20",
    },
    {
      icon: Clock,
      label: "نافذة الإرسال: 8 ص — 10 م",
      color: "text-blue-400",
      bg:    "bg-blue-500/10 border-blue-500/20",
    },
    {
      icon: Antenna,
      label: "إعادة اتصال تلقائية",
      color: "text-purple-400",
      bg:    "bg-purple-500/10 border-purple-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(({ icon: Icon, label, color, bg }, i) => (
        <div key={i} className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs font-medium", bg)}>
          <Icon className={cn("w-4 h-4 flex-shrink-0", color)} />
          <span className={color}>{label}</span>
        </div>
      ))}
    </div>
  );
}
