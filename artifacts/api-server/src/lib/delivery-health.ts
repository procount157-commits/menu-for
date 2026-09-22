// ── Delivery health ───────────────────────────────────────────────
// The failure mode this exists to catch: when WhatsApp starts throttling a
// number, sends keep SUCCEEDING. Baileys reports the message as sent, the
// campaign records status="sent", and the existing failure-rate guard sees a
// perfectly healthy campaign — while nothing is actually reaching anyone.
// The only signal that moves is the delivery receipt, which we already record
// in message_logs.deliveredAt but never previously read back.
//
// So: measure what fraction of sent messages were actually delivered, and stop
// the campaign when that collapses. This is the difference between losing 30
// messages and losing the number.

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, messageLogs } from "@workspace/db";

// A receipt needs time to come back, and it only arrives once the recipient's
// device next reaches the network. Messages younger than this are not evidence
// of anything, so they are excluded rather than counted as undelivered.
export const MATURITY_MINUTES = 20;

// Below this many mature messages the rate is noise — a handful of recipients
// with their phones off would read as a ban.
export const MIN_SAMPLE = 25;

// Healthy real-world delivery inside 20 minutes runs ~85–95%. These are set
// well under that so normal offline recipients never trip them.
export const RATE_DEGRADED  = 0.75;
export const RATE_HIGH_RISK = 0.55;
export const RATE_CRITICAL  = 0.35;

export type DeliveryLevel =
  | "insufficient_data"
  | "healthy"
  | "degraded"
  | "high_risk"
  | "critical";

export interface DeliveryHealth {
  sample:       number;
  delivered:    number;
  deliveryRate: number;      // 0..1, or 0 when there is no sample
  level:        DeliveryLevel;
  shouldPause:  boolean;
  shouldSlow:   boolean;
  reason:       string | null; // Arabic — goes straight into autoPauseReason
}

/**
 * Assess how much of what this campaign sent actually arrived.
 *
 * Only counts messages old enough for a receipt to have plausibly returned,
 * and only the most recent `window` of them, so a campaign that was healthy
 * for its first thousand messages still trips when it goes bad at message
 * 1001.
 */
export async function assessDeliveryHealth(
  campaignId: number,
  window = 100,
): Promise<DeliveryHealth> {
  const cutoff = new Date(Date.now() - MATURITY_MINUTES * 60_000);

  const rows = await db
    .select({ delivered: sql<number>`(${messageLogs.deliveredAt} is not null)::int` })
    .from(messageLogs)
    .where(and(
      eq(messageLogs.campaignId, campaignId),
      eq(messageLogs.status, "sent"),
      isNotNull(messageLogs.sentAt),
      lt(messageLogs.sentAt, cutoff),
    ))
    .orderBy(sql`${messageLogs.sentAt} desc`)
    .limit(window);

  const sample    = rows.length;
  const delivered = rows.reduce((n, r) => n + Number(r.delivered), 0);

  if (sample < MIN_SAMPLE) {
    return {
      sample, delivered, deliveryRate: 0,
      level: "insufficient_data", shouldPause: false, shouldSlow: false, reason: null,
    };
  }

  const deliveryRate = delivered / sample;
  const pct    = Math.round(deliveryRate * 100);
  const detail = `${delivered} من ${sample} رسالة (${pct}%) وصلت فعلياً خلال ${MATURITY_MINUTES} دقيقة`;

  if (deliveryRate >= RATE_DEGRADED) {
    return { sample, delivered, deliveryRate, level: "healthy", shouldPause: false, shouldSlow: false, reason: null };
  }

  if (deliveryRate >= RATE_HIGH_RISK) {
    return {
      sample, delivered, deliveryRate, level: "degraded",
      shouldPause: false, shouldSlow: true,
      reason: `انخفاض في نسبة التسليم — ${detail}`,
    };
  }

  if (deliveryRate >= RATE_CRITICAL) {
    return {
      sample, delivered, deliveryRate, level: "high_risk",
      shouldPause: true, shouldSlow: true,
      reason: `نسبة التسليم منخفضة: ${detail}. الإرسال ينجح لكن الرسائل لا تصل — مؤشر خنق من واتساب. أوقفنا الحملة لحماية الرقم.`,
    };
  }

  return {
    sample, delivered, deliveryRate, level: "critical",
    shouldPause: true, shouldSlow: true,
    reason: `انهيار التسليم: ${detail}. هذا نمط حظر شبه مؤكد — أوقفنا الحملة فوراً. لا تعِد التشغيل قبل مراجعة القائمة ومصدر الأرقام.`,
  };
}
