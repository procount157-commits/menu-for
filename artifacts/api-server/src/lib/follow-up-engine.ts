// ── Follow-up engine ──────────────────────────────────────────────
// Follows up with a lead on a fixed cadence after first contact, and stops the
// moment they answer. A sequence that keeps firing at someone who has already
// replied is not a follow-up, it is the thing that gets numbers reported, so
// stopOnReply is the default and cancellation is checked at send time too.
//
// Ad leads identify themselves: a click-to-WhatsApp ad stamps the first
// incoming message with referral data, which is what sourceFilter="ad" keys on.

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db, leadSourcesTable, followUpSequencesTable, followUpJobsTable,
  unsubscribedPhonesTable, incomingMessagesTable,
  type FollowUpStep,
} from "@workspace/db";
import { logger } from "./logger";
import { isWithinSendingHours } from "./sending-hours";
import { classify, INTENT_LABELS_AR, type Intent } from "./intent";
import { sendMessage, getStatus, registerInboundHook } from "./whatsapp";

// How often the worker looks for due jobs.
const TICK_MS = 60_000;
// Sends per tick per user. A hundred leads can reach their one-hour mark
// together; releasing them in a burst is exactly the pattern to avoid.
const MAX_PER_TICK_PER_USER = 5;
// A job this far past due is stale — after a long outage, a "one hour later"
// message arriving a week late reads as a mistake.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

// ── Referral extraction ───────────────────────────────────────────

export interface Referral {
  isAd:        boolean;
  adSourceId:  string | null;
  adSourceUrl: string | null;
  adTitle:     string | null;
  ctwaClid:    string | null;
  entryPoint:  string | null;
  raw:         Record<string, unknown> | null;
}

const EMPTY_REFERRAL: Referral = {
  isAd: false, adSourceId: null, adSourceUrl: null,
  adTitle: null, ctwaClid: null, entryPoint: null, raw: null,
};

/**
 * Pull ad-referral data out of a Baileys message.
 *
 * contextInfo hangs off whichever message variant was sent (extendedText,
 * image, video…), so rather than enumerate them this walks one level down
 * looking for the first contextInfo that carries referral fields.
 */
export function extractReferral(message: unknown): Referral {
  const root = (message as any)?.message ?? message;
  if (!root || typeof root !== "object") return EMPTY_REFERRAL;

  let ctx: any = null;
  for (const value of Object.values(root as Record<string, any>)) {
    const candidate = value?.contextInfo;
    if (candidate && (candidate.externalAdReply || candidate.entryPointConversionSource)) {
      ctx = candidate;
      break;
    }
  }
  if (!ctx) return EMPTY_REFERRAL;

  const ad = ctx.externalAdReply ?? {};
  const entryPoint = ctx.entryPointConversionSource ?? null;

  // Any of these three is enough: a click id, an ad id, or an entry point that
  // names an ad surface.
  const isAd = Boolean(
    ad.ctwaClid || ad.sourceId || (entryPoint && /ctwa|ad/i.test(String(entryPoint))),
  );

  return {
    isAd,
    adSourceId:  ad.sourceId  ?? null,
    adSourceUrl: ad.sourceUrl ?? null,
    adTitle:     ad.title     ?? null,
    ctwaClid:    ad.ctwaClid  ?? null,
    entryPoint,
    // Kept whole so a lead that was not recognised can still be inspected —
    // which matters before the first ad has ever run.
    raw: {
      entryPointConversionSource: entryPoint,
      entryPointConversionApp:    ctx.entryPointConversionApp ?? null,
      externalAdReply: ad.sourceId || ad.ctwaClid || ad.title ? {
        title: ad.title ?? null, body: ad.body ?? null,
        sourceType: ad.sourceType ?? null, sourceId: ad.sourceId ?? null,
        sourceUrl: ad.sourceUrl ?? null, sourceApp: ad.sourceApp ?? null,
        ctwaClid: ad.ctwaClid ?? null, ref: ad.ref ?? null,
      } : null,
    },
  };
}

// ── Lead recording and enrolment ──────────────────────────────────

/** Record where a lead came from. First contact wins; later messages do not overwrite. */
export async function recordLead(userId: number, phone: string, ref: Referral): Promise<"ad" | "organic"> {
  const source = ref.isAd ? "ad" : "organic";
  await db.insert(leadSourcesTable)
    .values({
      userId, phone, source,
      adSourceId: ref.adSourceId, adSourceUrl: ref.adSourceUrl, adTitle: ref.adTitle,
      ctwaClid: ref.ctwaClid, entryPoint: ref.entryPoint,
      rawReferral: ref.raw as any,
    })
    .onConflictDoUpdate({
      target: [leadSourcesTable.userId, leadSourcesTable.phone],
      set: {
        // Only ever upgrade organic -> ad. A lead who first arrived from an ad
        // stays an ad lead even if they message again from elsewhere.
        source:      sql`CASE WHEN ${leadSourcesTable.source} = 'ad' THEN 'ad' ELSE excluded.source END`,
        adSourceId:  sql`COALESCE(${leadSourcesTable.adSourceId},  excluded.ad_source_id)`,
        adSourceUrl: sql`COALESCE(${leadSourcesTable.adSourceUrl}, excluded.ad_source_url)`,
        adTitle:     sql`COALESCE(${leadSourcesTable.adTitle},     excluded.ad_title)`,
        ctwaClid:    sql`COALESCE(${leadSourcesTable.ctwaClid},    excluded.ctwa_clid)`,
        entryPoint:  sql`COALESCE(${leadSourcesTable.entryPoint},  excluded.entry_point)`,
        rawReferral: sql`COALESCE(${leadSourcesTable.rawReferral}, excluded.raw_referral)`,
      },
    });
  return source;
}

/**
 * Schedule every step of each matching active sequence.
 *
 * Offsets run from now — the moment of first contact. Idempotent: the unique
 * index on (sequence, phone, step) means re-running on a later message adds
 * nothing, which matters because this is called for every inbound message.
 */
export async function enrolLead(userId: number, phone: string, source: "ad" | "organic"): Promise<number> {
  const sequences = await db.select().from(followUpSequencesTable)
    .where(and(eq(followUpSequencesTable.userId, userId), eq(followUpSequencesTable.isActive, true)));

  const matching = sequences.filter((s) => s.sourceFilter === "all" || s.sourceFilter === source);
  if (matching.length === 0) return 0;

  const now = Date.now();
  const rows = matching.flatMap((seq) =>
    ((seq.steps as FollowUpStep[]) ?? []).map((step, i) => ({
      userId, sequenceId: seq.id, phone, stepIndex: i,
      dueAt: new Date(now + step.offsetMinutes * 60_000),
    })),
  );
  if (rows.length === 0) return 0;

  const inserted = await db.insert(followUpJobsTable)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: followUpJobsTable.id });

  if (inserted.length > 0) {
    logger.info({ userId, phone, source, scheduled: inserted.length }, "lead enrolled in follow-up");
  }
  return inserted.length;
}

/** Drop the rest of a lead's sequence. */
export async function cancelPendingFollowUps(userId: number, phone: string, reason: string): Promise<number> {
  const cancelled = await db.update(followUpJobsTable)
    .set({ status: "cancelled", error: reason })
    .where(and(
      eq(followUpJobsTable.userId, userId),
      eq(followUpJobsTable.phone, phone),
      eq(followUpJobsTable.status, "pending"),
    ))
    .returning({ id: followUpJobsTable.id });

  if (cancelled.length > 0) {
    logger.info({ userId, phone, reason, cancelled: cancelled.length }, "follow-up cancelled");
  }
  return cancelled.length;
}

// ── Inbound handling ──────────────────────────────────────────────

/**
 * Whether this is the lead's first message.
 *
 * A first message enrols; any later one is a reply and stops the sequence.
 * Counted from incoming_messages, which the caller has already written to.
 */
async function isFirstContact(userId: number, phone: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(incomingMessagesTable)
    .where(and(eq(incomingMessagesTable.userId, userId), eq(incomingMessagesTable.phone, phone)));
  return Number(row?.n ?? 0) <= 1;
}

export async function handleInbound(ev: { userId: number; phone: string; text: string; message: unknown }) {
  const { userId, phone, text } = ev;
  const ref = extractReferral(ev.message);
  const source = await recordLead(userId, phone, ref);

  if (await isFirstContact(userId, phone)) {
    await enrolLead(userId, phone, source);
    return;
  }

  // ── They answered ─────────────────────────────────────────────
  // Whether that ends the sequence depends on what they said. A bare "مرحبا"
  // is not engagement and the follow-ups should carry on; anything with real
  // content means a person should take over, so the queue is dropped.
  const sequences = await db.select().from(followUpSequencesTable)
    .where(and(eq(followUpSequencesTable.userId, userId), eq(followUpSequencesTable.isActive, true)));

  const useAi = sequences.some((s) => s.useAi);
  const verdict = await classify(text, useAi);

  await db.update(leadSourcesTable)
    .set({
      lastIntent:       verdict.intent,
      lastIntentAt:     new Date(),
      intentConfidence: String(verdict.confidence) as any,
      lastMessage:      text.slice(0, 1_000),
    })
    .where(and(eq(leadSourcesTable.userId, userId), eq(leadSourcesTable.phone, phone)));

  logger.info(
    { userId, phone, intent: verdict.intent, confidence: verdict.confidence, via: verdict.source, matched: verdict.matched },
    "reply classified",
  );

  // An explicit stop is honoured here as well as in the opt-out handler, so a
  // sequence cannot outlive the request through a path that missed it.
  if (verdict.intent === "opt_out") {
    await db.insert(unsubscribedPhonesTable)
      .values({ userId, phone, reason: "طلب الإيقاف في رد على متابعة" })
      .onConflictDoNothing();
    await cancelPendingFollowUps(userId, phone, "طلب الإيقاف");
    return;
  }

  // Per-sequence, because two sequences may disagree about what counts.
  for (const seq of sequences) {
    if (!seq.stopOnReply) continue;
    const carryOn = (seq.continueOnIntents as Intent[] | null) ?? ["greeting", "unclear"];
    if (carryOn.includes(verdict.intent)) continue;

    await db.update(followUpJobsTable)
      .set({ status: "cancelled", error: `رد العميل: ${INTENT_LABELS_AR[verdict.intent]}` })
      .where(and(
        eq(followUpJobsTable.userId, userId),
        eq(followUpJobsTable.phone, phone),
        eq(followUpJobsTable.sequenceId, seq.id),
        eq(followUpJobsTable.status, "pending"),
      ));
  }
}

// ── Worker ────────────────────────────────────────────────────────

/**
 * Send whatever is due.
 *
 * Deliberately conservative: outside sending hours nothing goes out and jobs
 * simply stay pending until the window opens, which turns a 3am follow-up into
 * a 9am one rather than dropping it.
 */
export async function runDueFollowUps(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };

  if (!isWithinSendingHours(now)) return result;

  const due = await db.select().from(followUpJobsTable)
    .where(and(eq(followUpJobsTable.status, "pending"), lte(followUpJobsTable.dueAt, now)))
    .orderBy(asc(followUpJobsTable.dueAt))
    .limit(200);
  if (due.length === 0) return result;

  // Expire anything long overdue rather than sending it late.
  const stale = due.filter((j) => now.getTime() - new Date(j.dueAt).getTime() > STALE_AFTER_MS);
  if (stale.length > 0) {
    await db.update(followUpJobsTable)
      .set({ status: "skipped", error: "تأخر أكثر من اللازم — أُلغي" })
      .where(inArray(followUpJobsTable.id, stale.map((j) => j.id)));
    result.skipped += stale.length;
  }

  const fresh = due.filter((j) => !stale.includes(j));
  const perUser = new Map<number, number>();

  for (const job of fresh) {
    const used = perUser.get(job.userId) ?? 0;
    if (used >= MAX_PER_TICK_PER_USER) continue;   // next tick
    if (!getStatus(job.userId).connected) continue; // stays pending

    // Opt-out wins over any schedule.
    const [optedOut] = await db.select({ phone: unsubscribedPhonesTable.phone })
      .from(unsubscribedPhonesTable)
      .where(and(eq(unsubscribedPhonesTable.userId, job.userId), eq(unsubscribedPhonesTable.phone, job.phone)))
      .limit(1);
    if (optedOut) {
      await db.update(followUpJobsTable)
        .set({ status: "cancelled", error: "ألغى الاشتراك" })
        .where(eq(followUpJobsTable.id, job.id));
      result.skipped++;
      continue;
    }

    const [seq] = await db.select().from(followUpSequencesTable)
      .where(eq(followUpSequencesTable.id, job.sequenceId));
    const step = ((seq?.steps as FollowUpStep[]) ?? [])[job.stepIndex];

    if (!seq?.isActive || !step) {
      await db.update(followUpJobsTable)
        .set({ status: "cancelled", error: seq?.isActive ? "الخطوة لم تعد موجودة" : "التسلسل متوقف" })
        .where(eq(followUpJobsTable.id, job.id));
      result.skipped++;
      continue;
    }

    try {
      await sendMessage(job.userId, job.phone, step.message);
      await db.update(followUpJobsTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(followUpJobsTable.id, job.id));
      result.sent++;
      perUser.set(job.userId, used + 1);
      logger.info({ userId: job.userId, phone: job.phone, step: job.stepIndex, sequenceId: seq.id }, "follow-up sent");
    } catch (err: any) {
      await db.update(followUpJobsTable)
        .set({ status: "failed", error: String(err?.message ?? err).slice(0, 500) })
        .where(eq(followUpJobsTable.id, job.id));
      result.failed++;
      logger.warn({ userId: job.userId, phone: job.phone, err: err?.message }, "follow-up send failed");
    }

    // Space the sends inside a tick.
    await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 3_000));
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startFollowUpEngine() {
  registerInboundHook(handleInbound);

  if (timer) return;
  timer = setInterval(() => {
    runDueFollowUps().catch((err) => logger.error({ err }, "follow-up worker tick failed"));
  }, TICK_MS);
  logger.info({ tickSeconds: TICK_MS / 1000 }, "follow-up engine started");
}

export function stopFollowUpEngine() {
  if (timer) { clearInterval(timer); timer = null; }
}
