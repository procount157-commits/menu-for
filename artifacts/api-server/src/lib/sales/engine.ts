// ── The seller's day ──────────────────────────────────────────────
// Every minute, inside its hours and days: the follow-ups that are due (a few
// at a time), then at most one new conversation — spaced so the day's quota
// is spread over the whole window, not fired in the first ten minutes, and
// never above the number's own daily allowance or before it is warmed up.

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, salesProspectsTable, salesTouchesTable, unsubscribedPhonesTable } from "@workspace/db";
import { localParts } from "@workspace/menu-shared";
import { getStatus } from "../whatsapp";
import { getDailyRemaining, numberAgeDays } from "../daily-limit";
import { hourInSendingTz } from "../sending-hours";
import { isHumanHeld } from "../lead-card";
import { logger } from "../logger";
import { salesSettings, sendFollowUp, sendOpener, sentToday, setStage } from "./service";
import type { SalesSettings } from "./brief";

export const WARMUP_DAYS = 2;
const FOLLOWUPS_PER_TICK = 3;

/** Minutes between two new conversations: the window shared by the day's quota, ±30%, never under two. Pure. */
export function openerGapMinutes(s: Pick<SalesSettings, "hourFrom" | "hourTo" | "dailyNew">, rand = Math.random()): number {
  const window = Math.max(60, (s.hourTo - s.hourFrom) * 60);
  const base = window / Math.max(1, s.dailyNew);
  return Math.max(2, base * (0.7 + rand * 0.6));
}

/** Why the seller may not send now, or null. Pure. */
export function closedReason(s: SalesSettings, now: Date): string | null {
  if (!s.active) return "البرنامج متوقف";
  if (!s.waUserId) return "لم يُختر رقم واتساب";
  const p = localParts(s.tz, now);
  if (!s.days.includes(p.weekday)) return "يوم إجازة";
  if (p.hour < s.hourFrom || p.hour >= s.hourTo) return "خارج ساعات العمل";
  return null;
}

export interface TickResult { reason: string | null; followUps: number; openers: number }

let running = false;
let nextOpenerAt = 0;
/** The firewall said no for the number today: nothing more is tried until the next day (sending timezone). */
let heldUntil = 0;
const holdForToday = (now: Date) => { heldUntil = now.getTime() + (24 - hourInSendingTz(now)) * 3_600_000; };

export async function salesTick(now = new Date(), o: { ignoreSpacing?: boolean; maxOpeners?: number; settings?: SalesSettings } = {}): Promise<TickResult> {
  const res: TickResult = { reason: null, followUps: 0, openers: 0 };
  if (running) return { ...res, reason: "دورة أخرى تعمل" };
  running = true;
  try {
    const s = o.settings ?? await salesSettings();
    const closed = closedReason(s, now);
    if (closed) return { ...res, reason: closed };
    const wa = s.waUserId!;
    if (!s.dryRun && now.getTime() < heldUntil) return { ...res, reason: "الحاجز التلقائي أوقف الإرسال لليوم" };
    let room = Infinity;
    if (!s.dryRun) {
      if (!(getStatus(wa) as { connected?: boolean })?.connected) return { ...res, reason: "واتساب غير متصل" };
      if ((await numberAgeDays(wa)) < WARMUP_DAYS) return { ...res, reason: `الرقم في الإحماء (أقل من ${WARMUP_DAYS} يوم)` };
      room = await getDailyRemaining(wa);
      if (room <= 0) return { ...res, reason: "وصل الحد اليومي للرقم" };
    }

    // 1. Follow-ups that are due.
    const due = await db.select().from(salesProspectsTable)
      .where(and(eq(salesProspectsTable.waUserId, wa), inArray(salesProspectsTable.stage, ["contacted", "replied", "interested"]), lte(salesProspectsTable.nextAt, now)))
      .orderBy(asc(salesProspectsTable.nextAt)).limit(FOLLOWUPS_PER_TICK);
    for (const p of due) {
      if (room <= 0) break;
      const [unsub] = await db.select({ id: unsubscribedPhonesTable.id }).from(unsubscribedPhonesTable).where(and(eq(unsubscribedPhonesTable.userId, wa), eq(unsubscribedPhonesTable.phone, p.phone))).limit(1);
      if (unsub) { await setStage(p, "stopped", "طلب الإيقاف"); continue; }
      if (await isHumanHeld(wa, p.phone).catch(() => false)) {
        await db.update(salesProspectsTable).set({ nextAt: new Date(now.getTime() + 86_400_000) }).where(eq(salesProspectsTable.id, p.id)); continue;
      }
      const r = await sendFollowUp(s, p, now);
      if (r === "held") { holdForToday(now); return { ...res, reason: "الحاجز التلقائي أوقف الإرسال لليوم" }; }
      if (r === "sent" || r === "dry") { res.followUps++; room--; }
    }

    // 2. A new conversation, if today's quota and the spacing allow.
    const max = o.maxOpeners ?? 1;
    if (s.dailyNew > 0 && room > 0) {
      const today = await sentToday(wa, s.tz, ["opener"], now);
      let left = Math.min(max, s.dailyNew - today, room);
      if (!o.ignoreSpacing && now.getTime() < nextOpenerAt) left = 0;
      while (left > 0) {
        const [p] = await db.select().from(salesProspectsTable)
          .where(and(eq(salesProspectsTable.waUserId, wa), eq(salesProspectsTable.stage, "new"),
            sql`NOT EXISTS (SELECT 1 FROM unsubscribed_phones u WHERE u.user_id = ${wa} AND u.phone = ${salesProspectsTable.phone})`))
          .orderBy(desc(salesProspectsTable.priority), asc(salesProspectsTable.id)).limit(1);
        if (!p) break;
        const r = await sendOpener(s, p, now);
        if (r === "held") { holdForToday(now); return { ...res, reason: "الحاجز التلقائي أوقف الإرسال لليوم" }; }
        if (r === "failed") { await setStage(p, "stopped", "تعذّر الإرسال"); }
        else res.openers++;
        left--;
        nextOpenerAt = now.getTime() + openerGapMinutes(s) * 60_000;
      }
    }
    return res;
  } catch (err: any) {
    logger.warn({ err: String(err?.message ?? err) }, "sales tick failed");
    return { ...res, reason: "خطأ" };
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startSalesEngine() {
  if (timer) return;
  timer = setInterval(() => { void salesTick(); }, 60_000);
  timer.unref?.();
  logger.info("موظف مبيعات منيو فور يو يعمل — دورة كل دقيقة");
}

/** For the panel: the last openers' times, to show the spacing is real. */
export async function recentOpeners(waUserId: number, limit = 10) {
  return db.select({ at: salesTouchesTable.at, status: salesTouchesTable.status }).from(salesTouchesTable)
    .where(and(eq(salesTouchesTable.waUserId, waUserId), eq(salesTouchesTable.kind, "opener"))).orderBy(desc(salesTouchesTable.at)).limit(limit);
}
