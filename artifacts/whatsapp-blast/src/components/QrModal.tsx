import { useState, useEffect, useCallback } from "react";
import { useGetWhatsappStatus } from "@workspace/api-client-react";
import { X, Wifi, Loader2, RefreshCw, Smartphone, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SNOOZE_MS = 30_000; // 30s — re-appears if still disconnected

export default function QrModal() {
  const [open, setOpen]       = useState(false);
  const [healing, setHealing] = useState(false);
  const [snoozedAt, setSnoozedAt] = useState<number | null>(null);

  const { data: status, refetch } = useGetWhatsappStatus({
    query: { refetchInterval: 4_000 } as any,
  });

  const connected        = !!status?.connected;
  const waStatus         = (status as any)?.status as string | undefined;
  const qr               = (status as any)?.qr as string | null | undefined;
  const loggedOutRetries = ((status as any)?.loggedOutRetries ?? 0) as number;
  const isQrReady        = waStatus === "qr_ready";
  const isReconn         = waStatus === "reconnecting" || waStatus === "connecting";
  // "stuck" = reconnecting for 30+ loggedOut retries → session likely truly dead
  const isStuck          = isReconn && loggedOutRetries >= 30;
  const isDead           = !connected && !isReconn && !isQrReady;

  // Auto-open when there is an actionable problem
  useEffect(() => {
    if (connected) {
      setOpen(false);
      setSnoozedAt(null);
      return;
    }

    // Don't re-open during snooze window
    if (snoozedAt && Date.now() - snoozedAt < SNOOZE_MS) return;

    // Open if QR is ready, connection is dead, or session is stuck in loggedOut loop
    if (isQrReady || isDead || isStuck) {
      setOpen(true);
    }
  }, [connected, isQrReady, isDead, isStuck, snoozedAt]);

  // Auto-snooze re-opener
  useEffect(() => {
    if (!snoozedAt) return;
    const t = setTimeout(() => {
      setSnoozedAt(null);
    }, SNOOZE_MS);
    return () => clearTimeout(t);
  }, [snoozedAt]);

  const handleClose = () => {
    setOpen(false);
    setSnoozedAt(Date.now());
  };

  const handleAutoHeal = useCallback(async () => {
    setHealing(true);
    try {
      const res = await fetch("/api/whatsapp/auto-heal", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (data.action === "reconnect_triggered") {
        toast.success("جاري إعادة الاتصال تلقائياً...");
        setTimeout(() => refetch(), 2000);
      } else if (data.action === "qr_required") {
        toast.info("امسح الـ QR بهاتفك لإعادة الاتصال");
      } else if (data.action === "in_progress") {
        toast.info("جاري الاتصال، انتظر قليلاً...");
      }
    } catch {
      toast.error("تعذّر الوصول للخادم");
    } finally {
      setTimeout(() => setHealing(false), 3000);
    }
  }, [refetch]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        dir="rtl"
      >
        {/* Header */}
        <div className={cn(
          "flex items-center justify-between px-5 py-4 border-b border-border",
          isQrReady  ? "bg-blue-500/10"
          : isStuck  ? "bg-orange-500/10"
          : isDead   ? "bg-red-500/10"
                     : "bg-yellow-500/10"
        )}>
          <div className="flex items-center gap-2.5">
            {isQrReady
              ? <Smartphone className="w-5 h-5 text-blue-400" />
              : isStuck
                ? <AlertCircle className="w-5 h-5 text-orange-400" />
              : isDead
                ? <AlertCircle className="w-5 h-5 text-red-400" />
                : <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />}
            <div>
              <p className={cn(
                "font-bold text-sm",
                isQrReady ? "text-blue-400" : isStuck ? "text-orange-400" : isDead ? "text-red-400" : "text-yellow-400"
              )}>
                {isQrReady ? "امسح QR للاتصال"
                : isStuck  ? `الجلسة منتهية (${loggedOutRetries} محاولة)`
                : isDead   ? "الواتساب غير متصل"
                           : "جاري إعادة الاتصال..."}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isQrReady
                  ? "افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز"
                  : isStuck
                    ? "الجلسة انتهت — اضغط إصلاح لمسح QR جديد"
                  : isDead
                    ? "انقطع الاتصال — سيُصلَح تلقائياً"
                    : "النظام يحاول إعادة الاتصال..."}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Image */}
        {isQrReady && (
          <div className="flex flex-col items-center py-6 px-4 gap-4">
            {qr ? (
              <div className="relative">
                <div className="w-52 h-52 rounded-xl overflow-hidden bg-white p-2 shadow-lg ring-4 ring-blue-500/30">
                  <img src={qr} alt="QR Code" className="w-full h-full" />
                </div>
                {/* Live pulse indicator */}
                <span className="absolute -top-1.5 -left-1.5 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
                </span>
              </div>
            ) : (
              <div className="w-52 h-52 rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-3 border border-border">
                <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                <p className="text-xs text-muted-foreground">جاري تحضير QR...</p>
              </div>
            )}

            <div className="text-center space-y-1 max-w-xs">
              <p className="text-sm font-semibold text-foreground">كيفية الربط:</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                واتساب <span className="text-foreground">←</span> النقاط الثلاث
                <span className="text-foreground"> ← </span> الأجهزة المرتبطة
                <span className="text-foreground"> ← </span> ربط جهاز
                <span className="text-foreground"> ← </span> امسح هذا الكود
              </p>
              <p className="text-[10px] text-blue-400 mt-1">• يتجدد تلقائياً كل 20 ثانية</p>
            </div>
          </div>
        )}

        {/* Reconnecting state */}
        {isReconn && (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">جاري إعادة الاتصال تلقائياً...</p>
            <p className="text-xs text-muted-foreground/70">هذا يحدث تلقائياً، لا داعي لأي إجراء</p>
          </div>
        )}

        {/* Disconnected state */}
        {isDead && (
          <div className="flex flex-col items-center py-6 px-5 gap-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <Wifi className="w-8 h-8 text-red-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">انقطع اتصال الواتساب</p>
              <p className="text-xs text-muted-foreground">
                النظام يحاول إعادة الاتصال تلقائياً. إذا استمر الانقطاع، اضغط إصلاح.
              </p>
            </div>
            <button
              onClick={handleAutoHeal}
              disabled={healing}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all",
                healing
                  ? "bg-primary/20 text-primary cursor-not-allowed"
                  : "bg-primary text-white hover:bg-primary/90 active:scale-95 shadow-md"
              )}
            >
              {healing
                ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الإصلاح...</>
                : <><RefreshCw className="w-4 h-4" />إصلاح الاتصال الآن</>}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            {connected ? "✅ متصل" : "🔄 يُراقَب كل 4 ثوانٍ"}
          </p>
          <button
            onClick={handleClose}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            إغلاق مؤقتاً (30 ث)
          </button>
        </div>
      </div>
    </div>
  );
}
