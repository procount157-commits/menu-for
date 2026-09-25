// ── The intake coordinator ────────────────────────────────────────
// Turns ريم's assessment into a queue somebody can work.
//
// She sorts every contact by what the receipts say. That is a description, not
// a plan: 66 people who opened once are a fact, and which of them belongs in a
// follow-up sequence this week is a decision. This makes it, and records who
// made it — so a contact that gets chased can be traced back to the reason
// rather than appearing in the queue by magic.

import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  db, contactSegmentsTable, leadSourcesTable, unsubscribedPhonesTable,
  followUpSequencesTable, followUpJobsTable, botEmployeesTable,
} from "@workspace/db";
import { enrolLead } from "./follow-up-engine";
import { say } from "./agent-comms";
import { logger } from "./logger";

export const INTAKE_ROLE = "intake";

/**
 * Segments worth a sequence, and the order to take them in.
 *
 * "delivered" is deliberately absent. Someone the message reached and who
 * never opened it has given no signal at all, and a ladder of seven nudges at
 * a person who has not once looked is how an account collects complaints.
 * They are better served by a different campaign than by being chased.
 */
const QUEUEABLE = ["warm", "curious"] as const;

/** Below this, an open is too old or too thin to be worth seven messages. */
const MIN_SCORE = 45;

export type IntakeResult = {
  considered: number;
  queued: number;
  skipped: Record<string, number>;
  top: Array<{ phone: string; score: number; segment: string; reason: string }>;
};

export async function runIntake(userId: number, limit = 50): Promise<IntakeResult> {
  const skipped: Record<string, number> = {};
  const bump = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };

  const [candidates, optedOut, already, [sequence]] = await Promise.all([
    db.select().from(contactSegmentsTable)
      .where(and(
        eq(contactSegmentsTable.userId, userId),
        inArray(contactSegmentsTable.segment, [...QUEUEABLE]),
      ))
      .orderBy(desc(contactSegmentsTable.score)),
    db.select({ phone: unsubscribedPhonesTable.phone }).from(unsubscribedPhonesTable)
      .where(eq(unsubscribedPhonesTable.userId, userId)),
    db.select({ phone: leadSourcesTable.phone }).from(leadSourcesTable)
      .where(eq(leadSourcesTable.userId, userId)),
    db.select().from(followUpSequencesTable)
      .where(and(eq(followUpSequencesTable.userId, userId), eq(followUpSequencesTable.isActive, true)))
      .limit(1),
  ]);

  const out = new Set(optedOut.map((r) => r.phone));
  const enrolled = new Set(already.map((r) => r.phone));

  const chosen: IntakeResult["top"] = [];
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    if (out.has(c.phone))        { bump("طلب الإيقاف"); continue; }
    if (enrolled.has(c.phone))   { bump("مسجّل بالفعل"); continue; }
    if (c.score < MIN_SCORE)     { bump("الاهتمام ضعيف أو قديم"); continue; }
    chosen.push({ phone: c.phone, score: c.score, segment: c.segment, reason: c.reason ?? "" });
  }

  for (const c of chosen) {
    // "organic" is the honest label: they came from a campaign the owner sent
    // and responded to nothing, which is not the same as an ad click.
    await enrolLead(userId, c.phone, "organic").catch((err) =>
      logger.warn({ userId, phone: c.phone, err: String(err?.message ?? err) }, "تعذّر تسجيل عميل في المتابعة"));
    await db.update(leadSourcesTable)
      .set({ queuedBy: INTAKE_ROLE, queueNote: `${c.segment} · ${c.score} · ${c.reason}`.slice(0, 400) })
      .where(and(eq(leadSourcesTable.userId, userId), eq(leadSourcesTable.phone, c.phone)))
      .catch(() => {});
  }

  if (chosen.length > 0) {
    await say({
      userId, fromRole: INTAKE_ROLE, toRole: "followup", kind: "report",
      body: [`أضفت ${chosen.length} عميلاً إلى قائمة المتابعة. أعلاهم:`,
        ...chosen.slice(0, 5).map((c) => `- ${c.phone} (${c.score}) ${c.reason}`)].join("\n"),
    }).catch(() => {});
  }

  logger.info({ userId, considered: candidates.length, queued: chosen.length, dryRun: sequence?.dryRun },
    "منسّق القوائم أنهى جولة");

  return { considered: candidates.length, queued: chosen.length, skipped, top: chosen.slice(0, 10) };
}

/** The queue as it stands, for the board. */
export async function queueSnapshot(userId: number) {
  const rows = await db.select({
    phone:     leadSourcesTable.phone,
    source:    leadSourcesTable.source,
    intent:    leadSourcesTable.lastIntent,
    queuedBy:  leadSourcesTable.queuedBy,
    note:      leadSourcesTable.queueNote,
    createdAt: leadSourcesTable.firstSeenAt,
  }).from(leadSourcesTable)
    .where(eq(leadSourcesTable.userId, userId))
    .orderBy(desc(leadSourcesTable.firstSeenAt))
    .limit(60);

  const jobs = await db.select({
    phone:  followUpJobsTable.phone,
    step:   followUpJobsTable.stepIndex,
    status: followUpJobsTable.status,
    dueAt:  followUpJobsTable.dueAt,
  }).from(followUpJobsTable)
    .where(and(eq(followUpJobsTable.userId, userId), eq(followUpJobsTable.status, "pending")))
    .orderBy(followUpJobsTable.dueAt);

  const nextBy = new Map<string, typeof jobs[number]>();
  for (const j of jobs) if (!nextBy.has(j.phone)) nextBy.set(j.phone, j);

  return rows.map((r) => ({ ...r, next: nextBy.get(r.phone) ?? null }));
}
