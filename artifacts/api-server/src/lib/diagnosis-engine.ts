// Root-cause diagnosis + automatic maintenance engine.
//
// Combines two data sources for a user:
//   1. wa_session_events — connection lifecycle (disconnects, reconnects, QR, logouts)
//   2. message_logs      — send failures on their campaigns
//
// and produces a single, plain-language diagnosis with a ranked list of
// causes and concrete recommendations. Also exposes `runAutoMaintenance`,
// a safe self-healing routine that a background watchdog (or the user, via
// the diagnostics page) can invoke to nudge a degraded session back to
// health without any destructive action (never wipes creds automatically).

import { db, campaignsTable, messageLogs, waSessionEventsTable } from "@workspace/db";
import { eq, and, gte, desc, inArray } from "drizzle-orm";
import { decodeDisconnectReason, BENIGN_DISCONNECT_KEYS, QR_TIMEOUT_REASON, type DisconnectReasonInfo } from "./disconnect-reasons";
import { classifyFailure } from "./failure-classifier";
import { getHealth, validateSession, autoHeal } from "./whatsapp";
import { logger } from "./logger";

const log = logger.child({ mod: "diagnosis-engine" });

// ── Disconnect analysis ─────────────────────────────────────────────

export interface DisconnectCauseRow {
  reason: DisconnectReasonInfo;
  count: number;
  lastOccurredAt: string;
  benign: boolean;
}

function parseReasonCode(event: string, detail: string | null): number | null {
  if (event !== "reconnecting") return null;
  const m = /reason=(\d+)/.exec(detail ?? "");
  return m ? parseInt(m[1], 10) : null;
}

function isQrTimeout(event: string, detail: string | null): boolean {
  return event === "reconnecting" && /qr_timeout/.test(detail ?? "");
}

export async function analyzeDisconnects(userId: number, hours = 24): Promise<{
  windowHours: number;
  totalEvents: number;
  causes: DisconnectCauseRow[];
  loggedOutCount: number;
  qrReadyCount: number;
}> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({ event: waSessionEventsTable.event, detail: waSessionEventsTable.detail, createdAt: waSessionEventsTable.createdAt })
    .from(waSessionEventsTable)
    .where(and(eq(waSessionEventsTable.userId, userId), gte(waSessionEventsTable.createdAt, cutoff)))
    .orderBy(desc(waSessionEventsTable.createdAt));

  const byReason = new Map<string, { info: DisconnectReasonInfo; count: number; lastOccurredAt: string }>();
  let loggedOutCount = 0;
  let qrReadyCount = 0;

  for (const r of rows) {
    if (r.event === "logged_out") loggedOutCount++;
    if (r.event === "qr_ready") qrReadyCount++;
    if (r.event !== "reconnecting") continue;

    const info = isQrTimeout(r.event, r.detail) ? QR_TIMEOUT_REASON : decodeDisconnectReason(parseReasonCode(r.event, r.detail));
    const key = info.key;
    const existing = byReason.get(key);
    if (existing) {
      existing.count++;
    } else {
      byReason.set(key, { info, count: 1, lastOccurredAt: r.createdAt.toISOString() });
    }
  }

  const causes: DisconnectCauseRow[] = Array.from(byReason.values())
    .map((v) => ({ reason: v.info, count: v.count, lastOccurredAt: v.lastOccurredAt, benign: BENIGN_DISCONNECT_KEYS.has(v.info.key) }))
    .sort((a, b) => b.count - a.count);

  return { windowHours: hours, totalEvents: rows.length, causes, loggedOutCount, qrReadyCount };
}

// ── Send-failure analysis ───────────────────────────────────────────

export interface FailureCauseRow {
  key: string;
  label: string;
  retryable: boolean;
  count: number;
  sampleError: string | null;
}

export async function analyzeSendFailures(userId: number, hours = 24): Promise<{
  windowHours: number;
  totalFailed: number;
  totalSent: number;
  causes: FailureCauseRow[];
}> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const userCampaignIds = (
    await db.select({ id: campaignsTable.id }).from(campaignsTable).where(eq(campaignsTable.userId, userId))
  ).map((c) => c.id);

  if (!userCampaignIds.length) {
    return { windowHours: hours, totalFailed: 0, totalSent: 0, causes: [] };
  }

  const [failedLogs, sentCountRows] = await Promise.all([
    db.select({ error: messageLogs.error, createdAt: messageLogs.createdAt })
      .from(messageLogs)
      .where(and(inArray(messageLogs.campaignId, userCampaignIds), eq(messageLogs.status, "failed"), gte(messageLogs.createdAt, cutoff))),
    db.select({ id: messageLogs.id })
      .from(messageLogs)
      .where(and(inArray(messageLogs.campaignId, userCampaignIds), eq(messageLogs.status, "sent"), gte(messageLogs.createdAt, cutoff))),
  ]);

  const byCat = new Map<string, { label: string; retryable: boolean; count: number; sampleError: string | null }>();
  for (const f of failedLogs) {
    const c = classifyFailure(f.error);
    const existing = byCat.get(c.key);
    if (existing) {
      existing.count++;
    } else {
      byCat.set(c.key, { label: c.label, retryable: c.retryable, count: 1, sampleError: f.error });
    }
  }

  const causes: FailureCauseRow[] = Array.from(byCat.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count);

  return { windowHours: hours, totalFailed: failedLogs.length, totalSent: sentCountRows.length, causes };
}

// ── Combined root-cause diagnosis ───────────────────────────────────

export interface RootCauseDiagnosis {
  generatedAt: string;
  windowHours: number;
  connectionHealth: ReturnType<typeof getHealth>;
  disconnects: Awaited<ReturnType<typeof analyzeDisconnects>>;
  failures: Awaited<ReturnType<typeof analyzeSendFailures>>;
  headline: string;
  recommendations: string[];
}

export async function getRootCauseDiagnosis(userId: number, hours = 24): Promise<RootCauseDiagnosis> {
  const [disconnects, failures] = await Promise.all([
    analyzeDisconnects(userId, hours),
    analyzeSendFailures(userId, hours),
  ]);
  const connectionHealth = getHealth(userId);

  const recommendations: string[] = [];
  let headline: string;

  const topDisconnect = disconnects.causes.find((c) => !c.benign) ?? disconnects.causes[0];
  const topFailure = failures.causes[0];

  if (!connectionHealth.connected) {
    headline = "الحساب غير متصل حالياً بواتساب — هذا هو سبب توقف الإرسال.";
    recommendations.push("افتح صفحة «ربط الواتساب» وتحقق من حالة الاتصال أو امسح QR جديد إذا طُلب.");
  } else if (topDisconnect && !topDisconnect.benign && topDisconnect.count >= 2) {
    headline = `السبب الأرجح لمشاكل الإرسال: ${topDisconnect.reason.label} — تكرر ${topDisconnect.count} مرة خلال آخر ${hours} ساعة.`;
    recommendations.push(topDisconnect.reason.recommendation);
  } else if (topFailure && topFailure.count >= 3) {
    headline = `السبب الأبرز لفشل الإرسال: «${topFailure.label}» — ${topFailure.count} رسالة متأثرة.`;
    recommendations.push(
      topFailure.retryable
        ? "هذا الخطأ قابل لإعادة المحاولة — استخدم زر «إعادة محاولة الفاشلة» في صفحة الحملة بعد التأكد من استقرار الاتصال."
        : "هذا الخطأ غير قابل لإعادة المحاولة تلقائياً (رقم غير مسجل أو ملف وسائط مفقود) — راجع القائمة يدوياً."
    );
  } else if (disconnects.totalEvents === 0 && failures.totalFailed === 0) {
    headline = "لا توجد مشاكل ملحوظة خلال هذه الفترة — الاتصال والإرسال يعملان بشكل طبيعي. ✅";
  } else {
    headline = "لا يوجد سبب واحد بارز — المشاكل ضمن الحدود الطبيعية لتذبذب الشبكة.";
  }

  if (connectionHealth.extendedStatus === "broken_session") {
    recommendations.push("الجلسة في حالة «معطلة» بعد محاولات متكررة لتسجيل الخروج — قد تحتاج مسح QR جديد.");
  }
  if (connectionHealth.extendedStatus === "stale" || connectionHealth.extendedStatus === "degraded") {
    recommendations.push("هناك إخفاقات إرسال متتالية حالياً — النظام يراقب الوضع وسيعيد بناء الاتصال تلقائياً إذا استمر.");
  }
  if (disconnects.loggedOutCount >= 3) {
    recommendations.push(`تم رصد ${disconnects.loggedOutCount} حادثة «تسجيل خروج» — تأكد أن الرقم غير مسجّل دخول على جهاز أو متصفح آخر في نفس الوقت.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    connectionHealth,
    disconnects,
    failures,
    headline,
    recommendations: recommendations.length ? recommendations : ["لا توجد إجراءات مطلوبة حالياً."],
  };
}

// ── Automatic maintenance (self-healing) ────────────────────────────
//
// Safe, non-destructive actions only. Never clears credentials or forces a
// fresh QR — that remains a conscious user action via autoHeal()'s
// loggedOutRetries>=30 path or the manual "Restart Session" button.

export interface MaintenanceResult {
  action: "noop" | "validated" | "reconnect_triggered" | "flagged_for_user";
  diagnosis: string;
  ranAt: string;
}

export async function runAutoMaintenance(userId: number): Promise<MaintenanceResult> {
  const status = getHealth(userId);
  const ranAt = new Date().toISOString();

  try {
    if (status.connected && status.extendedStatus === "connected") {
      return { action: "noop", diagnosis: "الاتصال سليم — لا حاجة لصيانة.", ranAt };
    }

    if (status.extendedStatus === "broken_session") {
      await db.insert(waSessionEventsTable).values({
        userId, event: "auto_maintenance", detail: "broken_session detected — flagged for manual QR rescan (no auto-wipe)",
      });
      return {
        action: "flagged_for_user",
        diagnosis: "الجلسة في حالة معطلة بعد محاولات متكررة — يلزم تدخل المستخدم (مسح QR جديد) لتجنب فقدان بيانات الجلسة بالخطأ.",
        ranAt,
      };
    }

    if (status.status === "disconnected") {
      const result = await autoHeal(userId);
      await db.insert(waSessionEventsTable).values({
        userId, event: "auto_maintenance", detail: `disconnected → autoHeal() action=${result.action}`,
      });
      return { action: "reconnect_triggered", diagnosis: result.diagnosis, ranAt };
    }

    // connecting / reconnecting / qr_ready / degraded / stale — run a
    // read-only validation pass so we at least surface *why*, without
    // interrupting an in-progress reconnect cycle.
    const validation = validateSession(userId);
    await db.insert(waSessionEventsTable).values({
      userId, event: "auto_maintenance", detail: `status=${status.status} extendedStatus=${status.extendedStatus} allOk=${validation.allOk}`,
    });
    return {
      action: "validated",
      diagnosis: validation.allOk
        ? `الحالة الحالية «${status.extendedStatus}» — إعادة الاتصال قيد التقدم تلقائياً.`
        : "تم رصد مشكلة في مكونات الجلسة أثناء الفحص الدوري — راجع «Validate Session» للتفاصيل.",
      ranAt,
    };
  } catch (err: any) {
    log.error({ err, userId }, "auto-maintenance run failed");
    return { action: "noop", diagnosis: `تعذر تشغيل الصيانة التلقائية: ${err?.message ?? "unknown error"}`, ranAt };
  }
}
