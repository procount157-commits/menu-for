// ── The board ─────────────────────────────────────────────────────
// One column per employee, each showing what that employee is actually doing
// rather than what it is configured to do. Everything here is drawn from work
// already done — messages sent, arguments recorded, queues held — so a column
// cannot show activity that did not happen.

import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db, botEmployeesTable, agentMessagesTable, agentMemoryTable, agentRoutinesTable,
  agentRoutineRunsTable, conversationOwnerTable, autoReplyLogTable, agentHandoffsTable,
  opsAlertsTable, contactSegmentsTable, followUpJobsTable, followupDeliberationsTable,
  followUpSequencesTable, leadSourcesTable, agentSkillGrantsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { recentDeliberations, runFollowUpOfficer, STEP_LABELS } from "../lib/followup-officer";
import { runIntake, queueSnapshot } from "../lib/intake-agent";
import { SEGMENT_AR } from "../lib/collector-agent";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const day  = new Date(Date.now() - 24 * 60 * 60_000);

  const [
    team, messages, owners, replies, handoffs, alerts, memory,
    routines, runs, segments, jobs, delibs, [sequence], leads, grants,
  ] = await Promise.all([
    db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId)),
    db.select().from(agentMessagesTable).where(eq(agentMessagesTable.userId, userId))
      .orderBy(desc(agentMessagesTable.createdAt)).limit(80),
    db.select({ role: conversationOwnerTable.role, phone: conversationOwnerTable.phone, since: conversationOwnerTable.since })
      .from(conversationOwnerTable).where(eq(conversationOwnerTable.userId, userId)),
    db.select({
      role: autoReplyLogTable.agentRole, phone: autoReplyLogTable.phone,
      incoming: autoReplyLogTable.incoming, reply: autoReplyLogTable.reply,
      outcome: autoReplyLogTable.outcome, skipped: autoReplyLogTable.skipped,
      createdAt: autoReplyLogTable.createdAt,
    }).from(autoReplyLogTable)
      .where(and(eq(autoReplyLogTable.userId, userId), gte(autoReplyLogTable.createdAt, day)))
      .orderBy(desc(autoReplyLogTable.createdAt)).limit(60),
    db.select().from(agentHandoffsTable).where(and(eq(agentHandoffsTable.userId, userId), gte(agentHandoffsTable.createdAt, day)))
      .orderBy(desc(agentHandoffsTable.createdAt)).limit(30),
    db.select().from(opsAlertsTable).where(and(eq(opsAlertsTable.userId, userId), gte(opsAlertsTable.createdAt, day)))
      .orderBy(desc(opsAlertsTable.createdAt)).limit(10),
    db.select({ role: agentMemoryTable.role, kind: agentMemoryTable.kind, n: sql<number>`count(*)` })
      .from(agentMemoryTable).where(eq(agentMemoryTable.userId, userId))
      .groupBy(agentMemoryTable.role, agentMemoryTable.kind),
    db.select().from(agentRoutinesTable).where(eq(agentRoutinesTable.userId, userId)),
    db.select().from(agentRoutineRunsTable).where(and(eq(agentRoutineRunsTable.userId, userId), gte(agentRoutineRunsTable.createdAt, day)))
      .orderBy(desc(agentRoutineRunsTable.createdAt)).limit(20),
    db.select({ segment: contactSegmentsTable.segment, n: sql<number>`count(*)` })
      .from(contactSegmentsTable).where(eq(contactSegmentsTable.userId, userId))
      .groupBy(contactSegmentsTable.segment),
    db.select({ status: followUpJobsTable.status, step: followUpJobsTable.stepIndex, n: sql<number>`count(*)` })
      .from(followUpJobsTable).where(eq(followUpJobsTable.userId, userId))
      .groupBy(followUpJobsTable.status, followUpJobsTable.stepIndex),
    recentDeliberations(userId, 30),
    db.select().from(followUpSequencesTable)
      .where(and(eq(followUpSequencesTable.userId, userId), eq(followUpSequencesTable.isActive, true))).limit(1),
    db.select({ n: sql<number>`count(*)` }).from(leadSourcesTable).where(eq(leadSourcesTable.userId, userId)),
    db.select({ role: agentSkillGrantsTable.role, n: sql<number>`count(*)` })
      .from(agentSkillGrantsTable).where(eq(agentSkillGrantsTable.userId, userId))
      .groupBy(agentSkillGrantsTable.role),
  ]);

  const names = Object.fromEntries(team.map((e) => [e.role, { name: e.name, avatar: e.avatar }]));
  const now = Date.now();

  /** What this employee did today, newest first, as one stream. */
  const timelineFor = (role: string) => {
    const items: Array<{ at: Date; kind: string; text: string; phone?: string | null; tone?: string }> = [];

    for (const m of messages) {
      if (m.fromRole === role) items.push({ at: m.createdAt, kind: "قال", text: `إلى ${m.toRole ? names[m.toRole]?.name ?? m.toRole : "الفريق"}: ${m.body}`, phone: m.phone });
      else if (m.toRole === role) items.push({ at: m.createdAt, kind: "تلقّى", text: `من ${names[m.fromRole]?.name ?? m.fromRole}: ${m.body}`, phone: m.phone });
    }
    for (const r of replies) {
      if (r.role !== role) continue;
      items.push({
        at: r.createdAt, phone: r.phone,
        kind: r.reply ? "ردّ" : "صمت",
        text: r.reply ? `«${(r.incoming ?? "").slice(0, 60)}» → ${r.reply.slice(0, 160)}` : `«${(r.incoming ?? "").slice(0, 60)}» — ${r.skipped ?? ""}`,
        tone: r.outcome === "win" ? "good" : r.outcome === "loss" ? "bad" : undefined,
      });
    }
    for (const h of handoffs) {
      if (h.fromRole === role) items.push({ at: h.createdAt, kind: "سلّم", text: `إلى ${names[h.toRole]?.name ?? h.toRole} — ${h.reason}`, phone: h.phone });
      if (h.toRole === role)   items.push({ at: h.createdAt, kind: "استلم", text: `من ${names[h.fromRole ?? ""]?.name ?? h.fromRole ?? "—"} — ${h.reason}`, phone: h.phone });
    }
    if (role === "ops") for (const a of alerts) {
      items.push({ at: a.createdAt, kind: "نبّه", text: a.headline, tone: a.level === "critical" ? "bad" : "warn" });
    }
    if (role === "followup") for (const d of delibs) {
      items.push({
        at: d.createdAt, phone: d.phone,
        kind: d.verdict === "send" ? "قرّر الإرسال" : d.verdict === "drop" ? "أوقف المتابعة" : "أجّل",
        text: `${STEP_LABELS[d.step] ?? `مرحلة ${d.step + 1}`} — ${d.reason}`,
        tone: d.verdict === "send" ? "good" : d.verdict === "drop" ? "bad" : "warn",
      });
    }
    for (const r of runs) {
      const rt = routines.find((x) => x.id === r.routineId);
      if (rt?.role !== role) continue;
      items.push({ at: r.createdAt, kind: "مهمة دورية", text: `${rt.name}: ${(r.output ?? r.error ?? "").slice(0, 200)}`, tone: r.error ? "bad" : undefined });
    }

    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 25);
  };

  /** The one line that says what this employee is on right now. */
  const nowFor = (role: string, holding: number) => {
    const mine = routines.filter((r) => r.role === role && r.isActive);
    const next = mine
      .map((r) => {
        if (r.triggerKind === "daily" && r.atHour !== null) {
          const gulf = new Date(now + 4 * 3_600_000);
          let h = r.atHour - gulf.getUTCHours();
          if (h <= 0) h += 24;
          return { name: r.name, inMin: h * 60 - gulf.getUTCMinutes() };
        }
        const last = r.lastRunAt ? new Date(r.lastRunAt).getTime() : 0;
        const every = (r.everyMinutes ?? 60) * 60_000;
        return { name: r.name, inMin: Math.max(0, Math.round((last + every - now) / 60_000)) };
      })
      .sort((a, b) => a.inMin - b.inMin)[0];

    if (holding > 0) return `يحاور ${holding} عميلاً`;
    if (next) return `ينتظر «${next.name}» بعد ${next.inMin < 60 ? `${next.inMin} د` : `${Math.round(next.inMin / 60)} س`}`;
    return "بلا مهمة مجدولة";
  };

  const holdingBy = owners.reduce((a, o) => { a[o.role] = (a[o.role] ?? 0) + 1; return a; }, {} as Record<string, number>);

  res.json({
    columns: team
      .sort((a, b) => a.priority - b.priority)
      .map((e) => ({
        id: e.id, role: e.role, name: e.name, title: e.title, avatar: e.avatar,
        kind: e.kind, isActive: e.isActive, persona: e.persona,
        doingNow: nowFor(e.role, holdingBy[e.role] ?? 0),
        holding: holdingBy[e.role] ?? 0,
        conversations: owners.filter((o) => o.role === e.role).map((o) => o.phone).slice(0, 12),
        counts: {
          said:     messages.filter((m) => m.fromRole === e.role).length,
          received: messages.filter((m) => m.toRole === e.role && !m.readAt).length,
          replied:  replies.filter((r) => r.role === e.role && r.reply).length,
          silent:   replies.filter((r) => r.role === e.role && !r.reply).length,
          wins:     replies.filter((r) => r.role === e.role && r.outcome === "win").length,
          losses:   replies.filter((r) => r.role === e.role && r.outcome === "loss").length,
          skills:   Number(grants.find((g) => g.role === e.role)?.n ?? 0),
        },
        memory: Object.fromEntries(memory.filter((m) => m.role === e.role).map((m) => [m.kind, Number(m.n)])),
        routines: routines.filter((r) => r.role === e.role).map((r) => ({
          id: r.id, name: r.name, isActive: r.isActive,
          when: r.triggerKind === "daily" ? `${String(r.atHour).padStart(2, "0")}:00` : `كل ${r.everyMinutes} د`,
          lastRunAt: r.lastRunAt,
        })),
        timeline: timelineFor(e.role),
      })),

    followUp: {
      dryRun: sequence?.dryRun ?? true,
      active: !!sequence,
      sequenceId: sequence?.id ?? null,
      leads: Number(leads[0]?.n ?? 0),
      byStep: STEP_LABELS.map((label, i) => ({
        step: i, label,
        pending: Number(jobs.find((j) => j.status === "pending" && j.step === i)?.n ?? 0),
        sent:    Number(jobs.find((j) => j.status === "sent"    && j.step === i)?.n ?? 0),
      })),
      deliberations: delibs,
    },
    segments: { counts: Object.fromEntries(segments.map((s) => [s.segment, Number(s.n)])), labels: SEGMENT_AR },
  });
});

router.post("/intake/run",   async (req, res) => res.json(await runIntake(req.session.userId!)));
router.post("/followup/run", async (req, res) => res.json(await runFollowUpOfficer(req.session.userId!)));
router.get("/queue",         async (req, res) => res.json(await queueSnapshot(req.session.userId!)));

/** Let it send for real, or put it back in rehearsal. */
router.patch("/followup/dry-run", async (req, res) => {
  const userId = req.session.userId!;
  const dryRun = req.body?.dryRun !== false;
  const [row] = await db.update(followUpSequencesTable).set({ dryRun })
    .where(and(eq(followUpSequencesTable.userId, userId), eq(followUpSequencesTable.isActive, true)))
    .returning();
  if (!row) return res.status(404).json({ error: "لا يوجد تسلسل متابعة نشط" });
  res.json(row);
});

export default router;
