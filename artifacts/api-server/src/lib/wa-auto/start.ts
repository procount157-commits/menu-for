// ── Starting a campaign without a person pressing «ابدأ» ──────────
// The campaign engine is started from its route, by hand. A scheduled
// campaign and the weekly autopilot need the same start without a session —
// and with every gate the route applies (WhatsApp linked, the plan, the
// number's first 48 hours, today's allowance, the officer's hold), because
// an automatic send must not be allowed what a manual one is refused.
//
// The engine itself is untouched: the campaign is marked running and the
// engine's own resume path picks it up, with its pacing, delivery guard and
// opt-out filter.

import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, campaignsTable, contactsTable } from "@workspace/db";
import { getStatus } from "../whatsapp";
import { assertCanSend, PlanError } from "../plans";
import { numberAgeDays, getDailySentCount, getEffectiveDailyLimit } from "../daily-limit";
import { getControls } from "../ops-agent";
import { resumeRunningCampaigns } from "../../routes/campaigns";
import { logger } from "../logger";

export interface StartResult { ok: boolean; reason?: string; retry?: boolean }

/** Whether a campaign may start from this number right now, and why not. Pure in its inputs. */
export function startGate(s: { connected: boolean; ageHours: number; minHours: number; sentToday: number; dailyLimit: number; holdUntil: Date | null }, now = new Date()): StartResult {
  if (!s.connected) return { ok: false, retry: true, reason: "واتساب غير متصل — تبدأ الحملة عند عودة الاتصال" };
  if (s.holdUntil && s.holdUntil > now) return { ok: false, retry: true, reason: "مسؤول التشغيل أوقف الإرسال مؤقتاً لحماية الرقم" };
  if (s.ageHours < s.minHours) return { ok: false, reason: `الرقم مرتبط منذ أقل من ${s.minHours} ساعة — استخدمه في محادثات عادية أولاً` };
  if (s.sentToday >= s.dailyLimit) return { ok: false, retry: true, reason: `وصل الرقم لحد اليوم (${s.dailyLimit} رسالة)` };
  return { ok: true };
}

export async function startCampaignSafely(userId: number, campaignId: number): Promise<StartResult> {
  const [c] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId))).limit(1);
  if (!c) return { ok: false, reason: "الحملة غير موجودة" };
  if (!c.contactGroupId) return { ok: false, reason: "لا توجد قائمة للحملة" };
  if (c.status === "running") return { ok: true };
  try { await assertCanSend(userId); } catch (err) { if (err instanceof PlanError) return { ok: false, reason: err.message }; throw err; }

  const [age, sentToday, dailyLimit, controls] = await Promise.all([
    numberAgeDays(userId), getDailySentCount(userId), getEffectiveDailyLimit(userId), getControls(userId).catch(() => null),
  ]);
  const gate = startGate({
    connected: !!(getStatus(userId) as { connected?: boolean })?.connected,
    ageHours: age * 24, minHours: Number(process.env["WARMUP_MIN_HOURS"] ?? 48),
    sentToday, dailyLimit, holdUntil: controls?.holdUntil ?? null,
  });
  if (!gate.ok) return gate;

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(contactsTable)
    .where(and(eq(contactsTable.groupId, c.contactGroupId), eq(contactsTable.status, "active")));
  if (!n) return { ok: false, reason: "لا توجد أرقام صالحة في القائمة" };

  await db.update(campaignsTable).set({ status: "running", totalCount: n, scheduledAt: null }).where(eq(campaignsTable.id, campaignId));
  await resumeRunningCampaigns(userId);
  logger.info({ userId, campaignId, contacts: n }, "campaign started automatically");
  return { ok: true };
}

// ── Scheduled campaigns ───────────────────────────────────────────
// A campaign could always be given a time, and nothing ever looked at it: the
// field was saved and the campaign sat in draft. This is the clock.

let timer: NodeJS.Timeout | null = null;

export async function runScheduledCampaigns(now = new Date(), onlyUserId?: number): Promise<number> {
  const due = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.status, "draft"), isNotNull(campaignsTable.scheduledAt), lte(campaignsTable.scheduledAt, now),
      ...(onlyUserId ? [eq(campaignsTable.userId, onlyUserId)] : [])));
  let started = 0;
  for (const c of due) {
    if (!c.userId) continue;
    // More than a day late (the server was down, the number was unlinked):
    // a Thursday offer does not go out on Saturday.
    if (now.getTime() - c.scheduledAt!.getTime() > 24 * 3_600_000) {
      await db.update(campaignsTable).set({ scheduledAt: null, autoPauseReason: "فات موعد الجدولة بأكثر من يوم — لم تُرسل. اضبط موعداً جديداً أو ابدأها يدوياً." }).where(eq(campaignsTable.id, c.id));
      continue;
    }
    const r = await startCampaignSafely(c.userId, c.id).catch((err) => ({ ok: false, reason: String(err?.message ?? err), retry: false }));
    if (r.ok) { started++; continue; }
    if (r.retry) continue; // tried again next minute, until the day is out
    await db.update(campaignsTable).set({ scheduledAt: null, autoPauseReason: `لم تبدأ في موعدها: ${r.reason}` }).where(eq(campaignsTable.id, c.id));
  }
  return started;
}

export function startCampaignScheduler() {
  if (timer) return;
  timer = setInterval(() => { runScheduledCampaigns().catch((err) => logger.warn({ err: String(err?.message ?? err) }, "campaign scheduler failed")); }, 60_000);
  timer.unref?.();
}
