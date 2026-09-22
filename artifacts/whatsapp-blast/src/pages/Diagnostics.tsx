import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity, Send, RefreshCw, ShieldCheck, Zap, Radio,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Trash2, StopCircle,
  Stethoscope, Wrench, TrendingUp, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WaState {
  socketExists: boolean;
  socketGeneration: number;
  wsReadyState: number | null;
  wsReadyStateLabel: string;
  connectionState: string;
  connected: boolean;
  phone: string | null;
  name: string | null;
  reconnectCount: number;
  connectedAt: string | null;
  lastActivityAt: string;
  lastEventAt: string;
  lastSuccessfulSendAt: string | null;
  consecutiveSendFailures: number;
  loggedOutRetries: number;
  extendedStatus: string;
  socketUser: { id?: string; name?: string; lid?: string } | null;
  authState: {
    registered: boolean | null;
    me: string | null;
    platform: string | null;
    registrationId: number | null;
    noiseKey: string;
    signedIdentityKey: string;
    signedPreKey: string;
    account: string;
    deviceId: string | null;
    serverHasPreKeys: boolean | null;
  };
  diagListenerCount: number;
}

interface TraceStep {
  step: number;
  label: string;
  ok: boolean;
  detail?: string;
}

interface SendResult {
  steps: TraceStep[];
  msgId: string | null;
  ghostSend: boolean;
  upsertReceived: boolean;
  updateReceived: boolean;
}

interface ValidationCheck {
  name: string;
  ok: boolean;
  value: string;
}

interface LiveEvent {
  id: number;
  type: string;
  data: unknown;
  ts: string;
}

interface DisconnectCauseRow {
  reason: { code: number | null; key: string; label: string; explanation: string; severity: "info" | "warning" | "critical"; recommendation: string };
  count: number;
  lastOccurredAt: string;
  benign: boolean;
}

interface FailureCauseRow {
  key: string;
  label: string;
  retryable: boolean;
  count: number;
  sampleError: string | null;
}

interface RootCauseDiagnosis {
  generatedAt: string;
  windowHours: number;
  connectionHealth: { extendedStatus: string; connected: boolean; status: string };
  disconnects: { windowHours: number; totalEvents: number; causes: DisconnectCauseRow[]; loggedOutCount: number; qrReadyCount: number };
  failures: { windowHours: number; totalFailed: number; totalSent: number; causes: FailureCauseRow[] };
  headline: string;
  recommendations: string[];
}

interface MaintenanceResult {
  action: "noop" | "validated" | "reconnect_triggered" | "flagged_for_user";
  diagnosis: string;
  ranAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ago(isoStr: string | null | undefined): string {
  if (!isoStr) return "N/A";
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function stateBadgeColor(state: WaState): string {
  if (state.connected && state.extendedStatus === "connected") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (state.extendedStatus === "degraded")     return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (state.extendedStatus === "stale")        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (state.extendedStatus === "broken_session") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (state.connectionState === "qr_ready")    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (state.connectionState === "connecting" || state.connectionState === "reconnecting")
    return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function severityColor(sev: "info" | "warning" | "critical"): string {
  if (sev === "critical") return "border-red-500/30 bg-red-500/10 text-red-400";
  if (sev === "warning") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
  return "border-blue-500/20 bg-blue-500/5 text-blue-400";
}

const EVENT_COLORS: Record<string, string> = {
  "connection.update": "text-blue-400",
  "messages.upsert":  "text-green-400",
  "messages.update":  "text-yellow-400",
  "creds.update":     "text-purple-400",
  "connected":        "text-emerald-400",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StateCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3 space-y-1", accent ? "border-primary/30 bg-primary/5" : "border-border bg-card")}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn("text-sm font-mono font-semibold break-all", accent ? "text-primary" : "text-foreground")}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function StepRow({ step }: { step: TraceStep }) {
  return (
    <div className={cn("flex items-start gap-3 py-2 px-3 rounded-md border", step.ok ? "border-green-500/20 bg-green-500/5" : "border-red-500/30 bg-red-500/10")}>
      <div className="mt-0.5 flex-shrink-0">
        {step.ok
          ? <CheckCircle2 className="w-4 h-4 text-green-400" />
          : <XCircle className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", step.ok ? "text-green-300" : "text-red-300")}>{step.label}</p>
        {step.detail && (
          <p className={cn("text-xs mt-0.5 font-mono break-all", step.ok ? "text-muted-foreground" : "text-red-400")}>{step.detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Diagnostics() {
  // State
  const [waState, setWaState]           = useState<WaState | null>(null);
  const [stateErr, setStateErr]         = useState<string | null>(null);
  const [testPhone, setTestPhone]       = useState("");
  const [testMsg, setTestMsg]           = useState("🔬 Diagnostic ping — ignore");
  const [testing, setTesting]           = useState(false);
  const [sendResult, setSendResult]     = useState<SendResult | null>(null);
  const [validating, setValidating]     = useState(false);
  const [validation, setValidation]     = useState<{ checks: ValidationCheck[]; allOk: boolean } | null>(null);
  const [restarting, setRestarting]     = useState(false);
  const [restartMsg, setRestartMsg]     = useState<string | null>(null);
  const [events, setEvents]             = useState<LiveEvent[]>([]);
  const [eventsOn, setEventsOn]         = useState(false);
  const [stateDump, setStateDump]       = useState<string | null>(null);
  const sseRef                          = useRef<EventSource | null>(null);
  const evIdRef                         = useRef(0);

  // ── Root-cause diagnosis + auto-maintenance ────────────────────────
  const [diagnosis, setDiagnosis]       = useState<RootCauseDiagnosis | null>(null);
  const [diagnosisErr, setDiagnosisErr] = useState<string | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [maintaining, setMaintaining]   = useState(false);
  const [maintResult, setMaintResult]   = useState<MaintenanceResult | null>(null);

  // ── Poll WA state every 2s ────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/diagnostics/state", { credentials: "include" });
      if (!r.ok) { setStateErr(`HTTP ${r.status}`); return; }
      const d = await r.json() as WaState;
      setWaState(d);
      setStateErr(null);
    } catch (e: any) {
      setStateErr(e?.message ?? "fetch failed");
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const t = setInterval(fetchState, 2000);
    return () => clearInterval(t);
  }, [fetchState]);

  // ── Root-cause diagnosis ────────────────────────────────────────────
  const fetchDiagnosis = useCallback(async () => {
    setDiagnosisLoading(true);
    try {
      const r = await fetch("/api/diagnostics/root-cause?hours=24", { credentials: "include" });
      if (!r.ok) { setDiagnosisErr(`HTTP ${r.status}`); return; }
      const d = await r.json() as RootCauseDiagnosis;
      setDiagnosis(d);
      setDiagnosisErr(null);
    } catch (e: any) {
      setDiagnosisErr(e?.message ?? "fetch failed");
    } finally {
      setDiagnosisLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnosis();
    const t = setInterval(fetchDiagnosis, 30_000);
    return () => clearInterval(t);
  }, [fetchDiagnosis]);

  // ── Auto-maintenance (manual trigger) ────────────────────────────────
  const handleAutoMaintain = async () => {
    setMaintaining(true);
    setMaintResult(null);
    try {
      const r = await fetch("/api/diagnostics/auto-maintain", { method: "POST", credentials: "include" });
      const d = await r.json() as MaintenanceResult;
      setMaintResult(d);
      void fetchDiagnosis();
    } catch (e: any) {
      setMaintResult({ action: "noop", diagnosis: `Error: ${e?.message}`, ranAt: new Date().toISOString() });
    } finally {
      setMaintaining(false);
    }
  };

  // ── SSE live events ───────────────────────────────────────────────
  const startEvents = useCallback(() => {
    if (sseRef.current) return;
    const es = new EventSource("/api/diagnostics/events");
    sseRef.current = es;
    es.addEventListener("message", (e) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; data: unknown; ts: string };
        setEvents((prev) => [{ id: ++evIdRef.current, ...evt }, ...prev].slice(0, 200));
      } catch {}
    });
    es.onerror = () => {
      // SSE auto-reconnects; just log
    };
    setEventsOn(true);
  }, []);

  const stopEvents = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
    setEventsOn(false);
  }, []);

  // Auto-start SSE on mount, stop on unmount
  useEffect(() => {
    startEvents();
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [startEvents]);

  // ── Send Test ─────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!testPhone.trim()) return;
    setTesting(true);
    setSendResult(null);
    try {
      const r = await fetch("/api/diagnostics/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone.trim(), message: testMsg }),
      });
      const d = await r.json() as SendResult;
      setSendResult(d);
    } catch (e: any) {
      setSendResult({ steps: [{ step: 1, label: "Network Error", ok: false, detail: e?.message }], msgId: null, ghostSend: true, upsertReceived: false, updateReceived: false });
    } finally {
      setTesting(false);
    }
  };

  // ── Validate Session ──────────────────────────────────────────────
  const handleValidate = async () => {
    setValidating(true);
    try {
      const r = await fetch("/api/diagnostics/validate", { credentials: "include" });
      const d = await r.json() as { checks: ValidationCheck[]; allOk: boolean };
      setValidation(d);
    } catch (e: any) {
      setValidation({ checks: [{ name: "Error", ok: false, value: e?.message }], allOk: false });
    } finally {
      setValidating(false);
    }
  };

  // ── Restart Session ───────────────────────────────────────────────
  const handleRestart = async () => {
    if (!confirm("سيتم إيقاف الجلسة وإعادة بنائها. متأكد؟")) return;
    setRestarting(true);
    setRestartMsg(null);
    try {
      const r = await fetch("/api/diagnostics/restart", { method: "POST", credentials: "include" });
      const d = await r.json() as { ok: boolean; message?: string; error?: string };
      setRestartMsg(d.message ?? d.error ?? (d.ok ? "تمت إعادة التشغيل" : "فشل"));
    } catch (e: any) {
      setRestartMsg(`Error: ${e?.message}`);
    } finally {
      setRestarting(false);
    }
  };

  // ── Dump State ────────────────────────────────────────────────────
  const handleDump = () => {
    setStateDump(stateDump ? null : JSON.stringify(waState, null, 2));
  };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Activity className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">System Diagnostics</h1>
          <p className="text-xs text-muted-foreground">تشخيص مسار الإرسال — اثبت أين تتوقف الرسالة</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", waState?.connected ? "bg-green-400 animate-pulse" : "bg-red-400")} />
          <span className="text-xs text-muted-foreground">{waState ? "يتحدث كل 2 ث" : stateErr ? "خطأ" : "جاري التحميل..."}</span>
        </div>
      </div>

      {/* ── WA State Cards ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          حالة الـ Socket
        </h2>
        {stateErr && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            فشل جلب الحالة: {stateErr}
          </div>
        )}
        {waState && (
          <>
            {/* Status pill */}
            <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold", stateBadgeColor(waState))}>
              <div className={cn("w-2 h-2 rounded-full", waState.connected ? "bg-green-400 animate-pulse" : "bg-red-400")} />
              {waState.extendedStatus.toUpperCase()} — {waState.connectionState}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <StateCard label="Socket Exists" value={waState.socketExists ? "✓ YES" : "✗ NO"} accent={waState.socketExists} />
              <StateCard label="Socket Generation" value={String(waState.socketGeneration)} />
              <StateCard label="WS ReadyState" value={waState.wsReadyStateLabel} sub={`raw: ${waState.wsReadyState ?? "N/A"}`} accent={waState.wsReadyState === 1} />
              <StateCard label="Connected" value={waState.connected ? "✓ true" : "✗ false"} accent={waState.connected} />
              <StateCard label="Phone" value={waState.phone ?? "—"} />
              <StateCard label="Name" value={waState.name ?? "—"} />
              <StateCard label="Reconnect Count" value={String(waState.reconnectCount)} />
              <StateCard label="Send Failures" value={String(waState.consecutiveSendFailures)} />
              <StateCard label="Connected At" value={ago(waState.connectedAt)} sub={waState.connectedAt ? new Date(waState.connectedAt).toLocaleTimeString("ar") : undefined} />
              <StateCard label="Last Event" value={ago(waState.lastEventAt)} />
              <StateCard label="Last Successful Send" value={ago(waState.lastSuccessfulSendAt)} />
              <StateCard label="Diag Listeners" value={String(waState.diagListenerCount)} />
            </div>

            {/* Auth state mini-table */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auth State</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border">
                {Object.entries(waState.authState).map(([k, v]) => (
                  <div key={k} className="bg-card px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">{k}</p>
                    <p className={cn("text-xs font-mono mt-0.5 break-all",
                      String(v).startsWith("✓") ? "text-green-400" :
                      String(v).startsWith("✗") ? "text-red-400" : "text-foreground"
                    )}>{String(v ?? "—")}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Socket user */}
            {waState.socketUser && (
              <div className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-mono text-muted-foreground">
                <span className="text-primary font-semibold">socket.user</span> = {JSON.stringify(waState.socketUser)}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Root-Cause Diagnosis & Auto-Maintenance ── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-primary" />
            التشخيص الجذري والصيانة التلقائية
            <span className="text-[10px] text-muted-foreground font-normal mr-1">— آخر 24 ساعة، تحديث كل 30 ث</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchDiagnosis()}
              disabled={diagnosisLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/20 text-muted-foreground text-xs font-medium hover:bg-muted/40 transition-all disabled:opacity-50"
            >
              {diagnosisLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              تحديث
            </button>
            <button
              onClick={handleAutoMaintain}
              disabled={maintaining}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-all disabled:opacity-50"
            >
              {maintaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
              تشغيل الصيانة التلقائية الآن
            </button>
          </div>
        </div>

        {diagnosisErr && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            فشل جلب التشخيص: {diagnosisErr}
          </div>
        )}

        {diagnosis && (
          <>
            {/* Headline */}
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-foreground">{diagnosis.headline}</p>
                <ul className="space-y-1">
                  {diagnosis.recommendations.map((rec, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary">•</span>{rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Auto-maintenance result */}
            {maintResult && (
              <div className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-xs",
                maintResult.action === "noop" ? "border-border bg-muted/20 text-muted-foreground" :
                maintResult.action === "flagged_for_user" ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" :
                "border-green-500/30 bg-green-500/10 text-green-400"
              )}>
                <Wrench className="w-4 h-4 flex-shrink-0" />
                <span className="font-mono text-[10px] uppercase tracking-wide">{maintResult.action}</span>
                <span>{maintResult.diagnosis}</span>
              </div>
            )}

            {/* Disconnect causes */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                أسباب انقطاع الاتصال ({diagnosis.disconnects.totalEvents} حدث)
              </h3>
              {diagnosis.disconnects.causes.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2">لا توجد إعادة اتصال مسجلة خلال هذه الفترة ✅</p>
              ) : (
                <div className="space-y-1.5">
                  {diagnosis.disconnects.causes.map((c) => (
                    <div key={c.reason.key} className={cn("rounded-lg border px-3 py-2", severityColor(c.reason.severity))}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold">{c.reason.label}{c.benign && <span className="mr-1.5 font-normal opacity-70">(طبيعي)</span>}</span>
                        <span className="text-[10px] font-mono opacity-80">×{c.count} — آخر مرة {ago(c.lastOccurredAt)}</span>
                      </div>
                      <p className="text-[11px] mt-1 opacity-90">{c.reason.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Send failure causes */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                أسباب فشل الإرسال ({diagnosis.failures.totalFailed} فاشلة / {diagnosis.failures.totalSent} ناجحة)
              </h3>
              {diagnosis.failures.causes.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2">لا توجد رسائل فاشلة خلال هذه الفترة ✅</p>
              ) : (
                <div className="space-y-1.5">
                  {diagnosis.failures.causes.map((c) => (
                    <div key={c.key} className={cn("rounded-lg border px-3 py-2", c.retryable ? "border-yellow-500/30 bg-yellow-500/10" : "border-red-500/30 bg-red-500/10")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-xs font-bold", c.retryable ? "text-yellow-400" : "text-red-400")}>{c.label}</span>
                        <span className="text-[10px] font-mono opacity-80">×{c.count} — {c.retryable ? "قابل لإعادة المحاولة" : "غير قابل"}</span>
                      </div>
                      {c.sampleError && (
                        <p className="text-[10px] mt-1 font-mono text-muted-foreground truncate">{c.sampleError}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Send Test Message ── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          Send Test Message
          <span className="text-[10px] text-muted-foreground font-normal mr-1">— بدون حملات / طوابير / محاكاة / anti-ban</span>
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="رقم الهاتف (مثلاً 971501234567)"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            dir="ltr"
          />
          <input
            type="text"
            placeholder="نص الرسالة"
            value={testMsg}
            onChange={(e) => setTestMsg(e.target.value)}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSend}
            disabled={testing || !testPhone.trim()}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
              testing || !testPhone.trim()
                ? "bg-primary/30 text-primary/50 cursor-not-allowed"
                : "bg-primary text-white hover:bg-primary/90"
            )}
          >
            {testing ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الإرسال (45s max)...</> : <><Send className="w-4 h-4" />إرسال</>}
          </button>
        </div>

        {/* Trace */}
        {testing && !sendResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              ينتظر تأكيد Baileys + messages.upsert (حتى 45 ثانية)...
            </div>
            <div className="h-1 w-full bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary/50 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        )}
        {sendResult && (
          <div className="space-y-2">
            {/* Ghost-send banner */}
            {sendResult.ghostSend && (
              <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-red-400">GHOST SEND DETECTED</p>
                  <p className="text-xs text-red-300/80 mt-0.5">
                    {!sendResult.msgId
                      ? "Baileys أعاد undefined msgId — الرسالة لم تُرسل أبداً"
                      : "msgId موجود لكن messages.upsert لم يصل — احتمال ghost-send من WA"}
                  </p>
                </div>
              </div>
            )}
            {!sendResult.ghostSend && (
              <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-green-400">SEND CONFIRMED</p>
                  <p className="text-xs text-green-300/80 mt-0.5">msgId + messages.upsert كلاهما تم — الكود يعمل بشكل صحيح</p>
                </div>
              </div>
            )}
            {/* Steps */}
            <div className="space-y-1">
              {sendResult.steps.map((s) => <StepRow key={s.step} step={s} />)}
            </div>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { label: "msgId",            ok: !!sendResult.msgId,            val: sendResult.msgId ?? "NONE" },
                { label: "upsert received",  ok: sendResult.upsertReceived,     val: sendResult.upsertReceived ? "YES" : "NO" },
                { label: "update received",  ok: sendResult.updateReceived,     val: sendResult.updateReceived ? "YES" : "NO" },
              ].map(({ label, ok, val }) => (
                <div key={label} className={cn("rounded-lg border p-2 text-center", ok ? "border-green-500/20 bg-green-500/5" : "border-red-500/30 bg-red-500/10")}>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn("text-xs font-mono font-bold mt-0.5", ok ? "text-green-400" : "text-red-400")}>{val}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Controls Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Validate Session */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Validate Session
          </h2>
          <button
            onClick={handleValidate}
            disabled={validating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-all disabled:opacity-50"
          >
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            تحقق من الجلسة
          </button>
          {validation && (
            <div className="space-y-1">
              <div className={cn("text-xs font-bold mb-2", validation.allOk ? "text-green-400" : "text-red-400")}>
                {validation.allOk ? "✓ جميع الفحوصات نجحت" : "✗ توجد مشاكل في الجلسة"}
              </div>
              {validation.checks.map((c) => (
                <div key={c.name} className={cn("flex items-center justify-between gap-2 px-3 py-1.5 rounded border text-xs",
                  c.ok ? "border-green-500/20 bg-green-500/5" : "border-red-500/30 bg-red-500/10"
                )}>
                  <span className={c.ok ? "text-green-300" : "text-red-300"}>{c.name}</span>
                  <span className={cn("font-mono", c.ok ? "text-green-400" : "text-red-400")}>{c.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Restart + Dump */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Session Controls
          </h2>
          <div className="space-y-2">
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400 text-sm font-medium hover:bg-orange-500/20 transition-all disabled:opacity-50"
            >
              {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Restart WhatsApp Session
            </button>
            {restartMsg && (
              <div className="text-xs text-muted-foreground px-2 py-1.5 rounded bg-muted/30 border border-border">{restartMsg}</div>
            )}
            <button
              onClick={handleDump}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted/20 text-muted-foreground text-sm font-medium hover:bg-muted/40 transition-all"
            >
              <Zap className="w-4 h-4" />
              {stateDump ? "إخفاء State Dump" : "Dump WhatsApp State"}
            </button>
          </div>
          {stateDump && (
            <pre className="text-[10px] font-mono text-muted-foreground bg-background border border-border rounded-lg p-3 overflow-x-auto max-h-64 leading-relaxed">
              {stateDump}
            </pre>
          )}
        </section>
      </div>

      {/* ── Live Events ── */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            Live Events
            {eventsOn && (
              <span className="flex items-center gap-1 text-[10px] text-green-400 font-normal">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                STREAMING
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEvents([])}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
            >
              <Trash2 className="w-3 h-3" />
              مسح
            </button>
            {eventsOn
              ? (
                <button onClick={stopEvents} className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-[10px] text-red-400 hover:bg-red-500/20 transition-all">
                  <StopCircle className="w-3 h-3" />
                  إيقاف
                </button>
              ) : (
                <button onClick={startEvents} className="flex items-center gap-1 px-2 py-1 rounded border border-green-500/30 bg-green-500/10 text-[10px] text-green-400 hover:bg-green-500/20 transition-all">
                  <Radio className="w-3 h-3" />
                  تشغيل
                </button>
              )
            }
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background font-mono text-xs h-72 overflow-y-auto p-2 space-y-1">
          {events.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{eventsOn ? "في انتظار الأحداث..." : "SSE متوقف — اضغط تشغيل"}</p>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 py-0.5">
                <span className="text-muted-foreground/50 flex-shrink-0 w-20 text-right">{new Date(ev.ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className={cn("flex-shrink-0 w-32", EVENT_COLORS[ev.type] ?? "text-muted-foreground")}>{ev.type}</span>
                <span className="text-muted-foreground/70 truncate">{JSON.stringify(ev.data).slice(0, 120)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
