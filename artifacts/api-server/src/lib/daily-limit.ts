// ── Daily allowance ───────────────────────────────────────────────
// One number, one budget. Campaign sends and follow-up sends both come off the
// same WhatsApp account and both count toward the same ban risk, so they share
// a limit rather than each having their own.
//
// This used to live inside routes/campaigns.ts and counted message_logs alone,
// which made follow-ups invisible to it: a sequence could push hundreds of
// messages a day past a warm-up ramp that campaigns were carefully respecting.

import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  db, messageLogs, campaignsTable, waSessionEventsTable, followUpJobsTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";

// New numbers start low and grow, so day one cannot look like a blast.
//   Day 0 → 50   Day 1 → 65   Day 2 → 85   Day 5 → 185
//   Day 7 → 310  Day 10 → 680  Day 14 → 1500 (ceiling)
export const DAILY_LIMIT_MAX   = 1_500;
export const WARMUP_DAY0_LIMIT = 50;
export const WARMUP_DAILY_GROW = 1.30;

/** Today's allowance for this number, scaled by how long it has been connected. */
export async function getEffectiveDailyLimit(userId: number): Promise<number> {
  try {
    const [firstConn] = await db
      .select({ createdAt: waSessionEventsTable.createdAt })
      .from(waSessionEventsTable)
      .where(and(
        eq(waSessionEventsTable.userId, userId),
        eq(waSessionEventsTable.event, "connected"),
      ))
      .orderBy(asc(waSessionEventsTable.createdAt))
      .limit(1);

    if (!firstConn) return WARMUP_DAY0_LIMIT; // never connected — treat as brand new

    const daysSince = Math.floor(
      (Date.now() - new Date(firstConn.createdAt).getTime()) / (24 * 60 * 60 * 1_000),
    );
    return Math.min(DAILY_LIMIT_MAX, Math.round(WARMUP_DAY0_LIMIT * Math.pow(WARMUP_DAILY_GROW, daysSince)));
  } catch {
    return DAILY_LIMIT_MAX; // DB trouble — do not hard-stop sending
  }
}

/** Everything this number sent in the last 24h: campaigns and follow-ups together. */
export async function getDailySentCount(userId: number): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);

  const [campaigns] = await db
    .select({ total: count() })
    .from(messageLogs)
    .innerJoin(campaignsTable, eq(messageLogs.campaignId, campaignsTable.id))
    .where(and(
      eq(campaignsTable.userId, userId),
      eq(messageLogs.status, "sent"),
      gte(messageLogs.sentAt, cutoff),
    ));

  const [followUps] = await db
    .select({ total: count() })
    .from(followUpJobsTable)
    .where(and(
      eq(followUpJobsTable.userId, userId),
      eq(followUpJobsTable.status, "sent"),
      gte(followUpJobsTable.sentAt, cutoff),
    ));

  return Number(campaigns?.total ?? 0) + Number(followUps?.total ?? 0);
}

/** Room left today, never negative. */
export async function getDailyRemaining(userId: number): Promise<number> {
  const [limit, used] = await Promise.all([
    getEffectiveDailyLimit(userId),
    getDailySentCount(userId),
  ]);
  return Math.max(0, limit - used);
}
