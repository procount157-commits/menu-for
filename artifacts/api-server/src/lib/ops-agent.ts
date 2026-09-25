// ── The operations officer ────────────────────────────────────────
// Connection, pacing, reconnection, and staying unbanned.
//
// All of the machinery for this already existed — delivery health, account
// health, the warm-up curve, adaptive pacing — but nothing owned it. Each part
// reported a number, the sending loop read some of them, and no one was
// responsible for the whole picture or able to make a decision that lasted
// past the current message.
//
// The division of labour here is the important part. **The decisions are
// arithmetic, not judgement.** A model never decides how fast this account
// sends: it is given the officer's persona and the decision that was already
// made, and it writes the alert a person will read. A language model that
// could set a sending rate would be one confident mistake away from a banned
// number, and reasoning about that mistake afterwards is no consolation.
//
// Every control it can set makes the account send *less*. There is no action
// in here that speeds anything up; recovery happens by the officer standing
// down, which is a different thing from it deciding to push.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db, opsControlsTable, opsAlertsTable, campaignsTable, messageLogs,
  waSessionEventsTable, botEmployeesTable,
  type OpsControls,
} from "@workspace/db";
import { getStatus, getHealth, waManager } from "./whatsapp";
import { assessDeliveryHealth, assessAccountHealth } from "./delivery-health";
import { getDailySentCount, getEffectiveDailyLimit } from "./daily-limit";
import { complete } from "./llm";
import { logger } from "./logger";

export const OPS_ROLE = "ops";
export const OPS_SWEEP_MS = 10 * 60_000;

// ── What it looks at ─────────────────────────────────────────────

export type OpsSignals = {
  connected: boolean;
  status: string;
  /** Minutes since the socket last reported anything at all. */
  silentMin: number | null;
  /** Reconnects in the last six hours. Churn is itself a ban signal. */
  reconnects6h: number;
  deliveryLevel: string;
  deliveryRate: number | null;
  accountLevel: string;
  sentToday: number;
  dailyLimit: number;
  /** Failures as a share of today's attempts. */
  failureRate: number;
  activeCampaigns: number;
};

export async function gather(userId: number): Promise<OpsSignals> {
  const day = new Date(Date.now() - 24 * 60 * 60_000);
  const sixHours = new Date(Date.now() - 6 * 60 * 60_000);

  const [delivery, account, sentToday, dailyLimit, [recon], [today], [camps]] = await Promise.all([
    assessDeliveryHealth(userId).catch(() => null),
    assessAccountHealth(userId).catch(() => null),
    getDailySentCount(userId).catch(() => 0),
    getEffectiveDailyLimit(userId).catch(() => 0),
    db.select({ n: sql<number>`count(*)` }).from(waSessionEventsTable)
      .where(and(eq(waSessionEventsTable.userId, userId), eq(waSessionEventsTable.event, "connected"),
                 gte(waSessionEventsTable.createdAt, sixHours))),
    db.select({
      sent:   sql<number>`count(*) filter (where ${messageLogs.status} in ('sent','delivered','read'))`,
      failed: sql<number>`count(*) filter (where ${messageLogs.status} = 'failed')`,
    }).from(messageLogs).where(gte(messageLogs.createdAt, day)),
    db.select({ n: sql<number>`count(*)` }).from(campaignsTable)
      .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running"))),
  ]);

  const st = getStatus(userId) as any;
  const health = getHealth(userId) as any;
  const lastEvent = health?.lastEventReceivedAt ? new Date(health.lastEventReceivedAt).getTime() : null;

  const sent = Number(today?.sent ?? 0), failed = Number(today?.failed ?? 0);

  return {
    connected: !!st?.connected,
    status: st?.status ?? "unknown",
    silentMin: lastEvent ? Math.round((Date.now() - lastEvent) / 60_000) : null,
    reconnects6h: Number(recon?.n ?? 0),
    deliveryLevel: (delivery as any)?.level ?? "unknown",
    deliveryRate: (delivery as any)?.rate ?? null,
    accountLevel: (account as any)?.level ?? "unknown",
    sentToday, dailyLimit,
    failureRate: sent + failed > 0 ? failed / (sent + failed) : 0,
    activeCampaigns: Number(camps?.n ?? 0),
  };
}

// ── What it decides ──────────────────────────────────────────────

export type OpsAction = { kind: "throttle" | "ceiling" | "hold" | "reconnect"; value?: number; why: string };
export type Decision = {
  level: "ok" | "warning" | "critical";
  actions: OpsAction[];
  /** One line per finding, for the alert and for the model to write around. */
  findings: string[];
};

// Thresholds. Named rather than inlined because they are the policy, and the
// policy is what an owner will want to argue with.
const FAILURE_WARN     = 0.15;   // 15% of today's sends failing
const FAILURE_CRITICAL = 0.30;
const RECONNECT_CHURN  = 6;      // in six hours — a number under pressure reconnects
const SILENT_WARN_MIN  = 45;     // socket connected but hearing nothing
const QUOTA_NEAR       = 0.90;

/**
 * Decide from the signals alone. Pure, so the policy can be tested against a
 * table of situations without a database, a socket or a model.
 */
export function decide(s: OpsSignals): Decision {
  const findings: string[] = [];
  const actions: OpsAction[] = [];
  let level: Decision["level"] = "ok";
  const worse = (l: Decision["level"]) => {
    const rank = { ok: 0, warning: 1, critical: 2 };
    if (rank[l] > rank[level]) level = l;
  };

  // ── Connection ──
  if (!s.connected) {
    worse("critical");
    findings.push(`الاتصال منقطع (${s.status}).`);
    actions.push({ kind: "reconnect", why: "الجلسة منقطعة" });
    // Nothing can be sent anyway; a hold stops campaigns burning attempts
    // against a dead socket and logging them as failures, which would then
    // look like a delivery problem tomorrow.
    actions.push({ kind: "hold", value: 15, why: "لا إرسال على جلسة منقطعة" });
  } else if (s.silentMin !== null && s.silentMin >= SILENT_WARN_MIN) {
    worse("warning");
    findings.push(`متصل لكن لم تصل أي إشارة منذ ${s.silentMin} دقيقة — قد تكون الجلسة ميتة دون أن تُعلن ذلك.`);
    actions.push({ kind: "reconnect", why: "صمت طويل رغم الاتصال" });
  }

  // Reconnect churn is a ban precursor in its own right: WhatsApp sees a
  // number that keeps re-registering, and the usual cause is a session under
  // pressure rather than a flaky network.
  if (s.reconnects6h >= RECONNECT_CHURN) {
    worse("warning");
    findings.push(`${s.reconnects6h} إعادة اتصال خلال ٦ ساعات — تذبذب غير طبيعي.`);
    actions.push({ kind: "throttle", value: 2, why: "تذبذب الجلسة" });
  }

  // ── Delivery ──
  if (s.deliveryLevel === "critical" || s.accountLevel === "critical") {
    worse("critical");
    findings.push(`مؤشر التسليم حرج${s.deliveryRate !== null ? ` (${Math.round(s.deliveryRate * 100)}% فقط تصل)` : ""}.`);
    actions.push({ kind: "hold", value: 120, why: "التسليم حرج — الاستمرار يعني الحظر" });
  } else if (s.deliveryLevel === "high_risk" || s.accountLevel === "high_risk") {
    worse("critical");
    findings.push("مؤشر التسليم في نطاق الخطر.");
    actions.push({ kind: "throttle", value: 3, why: "التسليم في نطاق الخطر" });
    actions.push({ kind: "ceiling", value: Math.max(50, Math.round(s.dailyLimit * 0.4)), why: "تقليص الحصة حتى يتعافى" });
  } else if (s.deliveryLevel === "degraded" || s.accountLevel === "degraded") {
    worse("warning");
    findings.push("التسليم متراجع عن المعتاد.");
    actions.push({ kind: "throttle", value: 1.8, why: "تسليم متراجع" });
  }

  // ── Failures ──
  if (s.failureRate >= FAILURE_CRITICAL) {
    worse("critical");
    findings.push(`${Math.round(s.failureRate * 100)}% من محاولات اليوم فشلت.`);
    actions.push({ kind: "hold", value: 60, why: "نسبة فشل مرتفعة جداً" });
  } else if (s.failureRate >= FAILURE_WARN) {
    worse("warning");
    findings.push(`${Math.round(s.failureRate * 100)}% من محاولات اليوم فشلت.`);
    actions.push({ kind: "throttle", value: 2, why: "نسبة فشل مرتفعة" });
  }

  // ── Quota ──
  // Not a risk on its own, and no action: the daily limit already stops it.
  // Worth saying so the owner is not surprised when sending stops.
  if (s.dailyLimit > 0 && s.sentToday / s.dailyLimit >= QUOTA_NEAR) {
    findings.push(`استُهلك ${Math.round((s.sentToday / s.dailyLimit) * 100)}% من حصة اليوم (${s.sentToday}/${s.dailyLimit}).`);
  }

  if (findings.length === 0) {
    findings.push(`كل شيء طبيعي — ${s.sentToday} رسالة اليوم من ${s.dailyLimit}، والاتصال مستقر.`);
  }

  // Keep the strongest of each kind. Two throttles from two findings should
  // not multiply into a twelve-fold slowdown.
  const strongest = new Map<string, OpsAction>();
  for (const a of actions) {
    const prev = strongest.get(a.kind);
    if (!prev || (a.value ?? 0) > (prev.value ?? 0)) strongest.set(a.kind, a);
  }
  // A ceiling alongside a hold is noise: nothing is sending either way.
  if (strongest.has("hold")) strongest.delete("ceiling");

  return { level, actions: [...strongest.values()], findings };
}

// ── What it does about it ────────────────────────────────────────

export async function getControls(userId: number): Promise<OpsControls> {
  const [row] = await db.select().from(opsControlsTable).where(eq(opsControlsTable.userId, userId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(opsControlsTable).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(opsControlsTable).where(eq(opsControlsTable.userId, userId)).limit(1))[0]!;
}

async function apply(userId: number, actions: OpsAction[]): Promise<string[]> {
  const current = await getControls(userId);

  // An owner who has taken manual control keeps it. The officer still reports;
  // it just does not quietly undo a person's decision.
  if (current.setBy === "owner" && Date.now() - new Date(current.updatedAt).getTime() < 6 * 60 * 60_000) {
    return actions.length ? ["لم تُطبَّق أي إجراءات — التحكم اليدوي مفعّل من صاحب العمل."] : [];
  }

  const done: string[] = [];
  const set: Record<string, unknown> = { updatedAt: new Date(), setBy: "agent" };

  const throttle = actions.find((a) => a.kind === "throttle");
  const ceiling  = actions.find((a) => a.kind === "ceiling");
  const hold     = actions.find((a) => a.kind === "hold");

  set["throttle"] = String(throttle?.value ?? 1);
  if (throttle) done.push(`أبطأ الإرسال ${throttle.value}× (${throttle.why})`);

  set["dailyCeiling"] = ceiling?.value ?? null;
  if (ceiling) done.push(`خفض سقف اليوم إلى ${ceiling.value} (${ceiling.why})`);

  if (hold) {
    set["holdUntil"] = new Date(Date.now() + (hold.value ?? 30) * 60_000);
    done.push(`أوقف الإرسال ${hold.value} دقيقة (${hold.why})`);
  } else {
    // Only lift a hold the officer itself placed, and only once the reason is
    // gone — which is what "no hold action this sweep" means.
    set["holdUntil"] = null;
    if (current.holdUntil && new Date(current.holdUntil).getTime() > Date.now()) {
      done.push("رفع الإيقاف — السبب زال");
    }
  }

  set["reason"] = actions.map((a) => a.why).join("؛ ") || null;
  await db.update(opsControlsTable).set(set).where(eq(opsControlsTable.userId, userId));

  const reconnect = actions.find((a) => a.kind === "reconnect");
  if (reconnect) {
    try {
      waManager.get(userId);   // init() reconnects from stored creds
      done.push(`طلب إعادة اتصال (${reconnect.why})`);
    } catch (err) {
      logger.error({ userId, err: String((err as any)?.message ?? err) }, "فشل طلب إعادة الاتصال");
    }
  }
  return done;
}

/**
 * The alert text, in the officer's voice.
 *
 * The model writes only this. It is handed a decision that has already been
 * made and applied, and its job is to make it readable — not to revisit it.
 * When no model is reachable the findings stand on their own, which is why
 * they are written as sentences rather than as codes.
 */
async function narrate(userId: number, d: Decision, done: string[]): Promise<string> {
  const [emp] = await db.select().from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, OPS_ROLE))).limit(1);

  const plain = [...d.findings, ...(done.length ? ["", "ما فعلته:", ...done.map((x) => `• ${x}`)] : [])].join("\n");
  if (d.level === "ok") return plain;

  const out = await complete([
    { role: "system", content: [
      emp ? `أنت ${emp.name}${emp.title ? `، ${emp.title}` : ""}.` : "أنت مسؤول تشغيل.",
      emp?.persona ?? "",
      "تكتب تنبيهاً قصيراً لصاحب العمل عن حالة رقم واتساب يُرسل حملات.",
      "القرار اتُّخذ ونُفِّذ بالفعل — لا تقترح قراراً مختلفاً ولا تُشكّك فيه.",
      "اشرح بالعربية في ٣ أسطر كحد أقصى: ما الذي حدث، ولماذا يهم، وماذا على صاحب العمل أن يفعل إن كان عليه فعل شيء.",
      "لا تستخدم مصطلحات تقنية.",
      // It was told to explain numbers rather than repeat them, and read that
      // as licence to round: a 15-minute hold came back as "عشر دقائق". An
      // alert that misstates what was done is worse than a dry one.
      "أي رقم تذكره يجب أن يكون منقولاً حرفياً مما أُعطي لك. لا تقرّبه ولا تعيد صياغته. وإن لم تكن متأكداً فلا تذكر رقماً أصلاً.",
    ].filter(Boolean).join("\n") },
    { role: "user", content: plain },
  ]);
  return out?.text?.trim() || plain;
}

/** One full round: look, decide, act, write it down. */
export async function runOpsAgent(userId: number) {
  const signals = await gather(userId);
  const decision = decide(signals);
  const done = await apply(userId, decision.actions);
  const body = await narrate(userId, decision, done);

  const headline = decision.level === "ok"
    ? "الوضع مستقر"
    : decision.findings[0]!.slice(0, 190);

  // A quiet sweep is not worth a row: an alert list that is 95% "all fine"
  // is one nobody reads, which defeats the purpose of raising one at all.
  if (decision.level === "ok" && done.length === 0) {
    return { ...decision, signals, done, body, logged: false };
  }

  const [alert] = await db.insert(opsAlertsTable).values({
    userId, level: decision.level, headline, body,
    actions: done, signals: signals as any,
  }).returning();

  logger.info({ userId, level: decision.level, actions: done.length }, "مسؤول التشغيل أنهى جولة");
  return { ...decision, signals, done, body, logged: true, alertId: alert?.id };
}

export function startOpsAgent(): void {
  const sweep = async () => {
    try {
      for (const { userId } of waManager.allStates()) {
        await runOpsAgent(userId).catch((err) =>
          logger.error({ userId, err: String(err?.message ?? err) }, "فشلت جولة مسؤول التشغيل"));
      }
    } catch (err) {
      logger.error({ err: String((err as any)?.message ?? err) }, "فشل مرور مسؤول التشغيل");
    }
  };
  // Three minutes after boot, so sessions have finished restoring and the
  // officer does not open by declaring a healthy account disconnected.
  setTimeout(() => { void sweep(); setInterval(() => void sweep(), OPS_SWEEP_MS); }, 3 * 60_000);
  logger.info({ sweepMin: OPS_SWEEP_MS / 60_000 }, "مسؤول التشغيل بدأ");
}
