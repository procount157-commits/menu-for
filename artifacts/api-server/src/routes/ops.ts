// ── The agent dashboard ───────────────────────────────────────────
// One call, because the page is a single view of one team and four round
// trips would let its panels disagree with each other by a second.

import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db, botEmployeesTable, opsControlsTable, opsAlertsTable, agentHandoffsTable,
  conversationOwnerTable, autoReplyLogTable, agentMemoryTable, agentRoutinesTable,
  agentRoutineRunsTable, leadSourcesTable, followUpJobsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { scoreRisk, RISK_LEVEL_AR } from "../lib/risk";
import { funnel } from "../lib/lead-card";
import { runOpsAgent, getControls, gather, decide } from "../lib/ops-agent";
import { recentTraffic, say } from "../lib/agent-comms";
import { getStatus } from "../lib/whatsapp";
import { getDailySentCount, getEffectiveDailyLimit } from "../lib/daily-limit";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const day  = new Date(Date.now() - 24 * 60 * 60_000);
  const week = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const [
    team, controls, alerts, traffic, handoffs, owners, perAgent,
    memory, routines, lastRuns, [leads], [queued], sentToday, dailyLimit,
  ] = await Promise.all([
    db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId)),
    getControls(userId),
    db.select().from(opsAlertsTable).where(eq(opsAlertsTable.userId, userId))
      .orderBy(desc(opsAlertsTable.createdAt)).limit(12),
    recentTraffic(userId, 40),
    db.select().from(agentHandoffsTable).where(and(eq(agentHandoffsTable.userId, userId), gte(agentHandoffsTable.createdAt, week)))
      .orderBy(desc(agentHandoffsTable.createdAt)).limit(60),
    db.select({ role: conversationOwnerTable.role, n: sql<number>`count(*)` })
      .from(conversationOwnerTable).where(eq(conversationOwnerTable.userId, userId))
      .groupBy(conversationOwnerTable.role),
    db.select({
      role:    autoReplyLogTable.agentRole,
      replied: sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is not null)`,
      silent:  sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is null)`,
      wins:    sql<number>`count(*) filter (where ${autoReplyLogTable.outcome} in ('win','qualified'))`,
      losses:  sql<number>`count(*) filter (where ${autoReplyLogTable.outcome} in ('loss','quiet'))`,
    }).from(autoReplyLogTable)
      .where(and(eq(autoReplyLogTable.userId, userId), gte(autoReplyLogTable.createdAt, day)))
      .groupBy(autoReplyLogTable.agentRole),
    db.select({ role: agentMemoryTable.role, kind: agentMemoryTable.kind, n: sql<number>`count(*)` })
      .from(agentMemoryTable).where(eq(agentMemoryTable.userId, userId))
      .groupBy(agentMemoryTable.role, agentMemoryTable.kind),
    db.select().from(agentRoutinesTable).where(eq(agentRoutinesTable.userId, userId)),
    db.select().from(agentRoutineRunsTable).where(eq(agentRoutineRunsTable.userId, userId))
      .orderBy(desc(agentRoutineRunsTable.createdAt)).limit(10),
    db.select({
      total: sql<number>`count(*)`,
      hot:   sql<number>`count(*) filter (where ${leadSourcesTable.lastIntent} = 'interested')`,
    }).from(leadSourcesTable).where(eq(leadSourcesTable.userId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(followUpJobsTable)
      .where(and(eq(followUpJobsTable.userId, userId), eq(followUpJobsTable.status, "pending"))),
    getDailySentCount(userId).catch(() => 0),
    getEffectiveDailyLimit(userId).catch(() => 0),
  ]);

  const wa = getStatus(userId) as any;
  // The composite risk — what فهد acts on — and the sales funnel from the
  // lead cards. Both read here so the page and the officer cannot disagree.
  const [signals, leadFunnel] = await Promise.all([
    gather(userId).catch(() => null),
    funnel(userId).catch(() => null),
  ]);
  const risk = signals?.risk ? { ...scoreRisk(signals.risk), levelAr: RISK_LEVEL_AR[scoreRisk(signals.risk).level] } : null;
  const statsBy = new Map(perAgent.map((r) => [r.role ?? "", r]));
  const holdingBy = new Map(owners.map((r) => [r.role, Number(r.n)]));

  const ceiling = controls.dailyCeiling ?? null;
  const held = !!controls.holdUntil && new Date(controls.holdUntil).getTime() > Date.now();

  res.json({
    account: {
      connected: !!wa?.connected,
      status: wa?.status ?? "unknown",
      sentToday,
      dailyLimit: ceiling ? Math.min(dailyLimit, ceiling) : dailyLimit,
      warmupLimit: dailyLimit,
      leads: Number(leads?.total ?? 0),
      hotLeads: Number(leads?.hot ?? 0),
      pendingFollowUps: Number(queued?.n ?? 0),
    },
    controls: {
      throttle: Number(controls.throttle),
      dailyCeiling: ceiling,
      holdUntil: controls.holdUntil,
      held,
      reason: controls.reason,
      setBy: controls.setBy,
      updatedAt: controls.updatedAt,
    },
    team: team
      .sort((a, b) => a.priority - b.priority)
      .map((e) => {
        const s = statsBy.get(e.role);
        return {
          id: e.id, role: e.role, name: e.name, title: e.title, avatar: e.avatar,
          kind: e.kind, isActive: e.isActive, persona: e.persona, priority: e.priority,
          specialties: e.specialties,
          holding: holdingBy.get(e.role) ?? 0,
          replied24h: Number(s?.replied ?? 0),
          silent24h:  Number(s?.silent  ?? 0),
          wins:       Number(s?.wins    ?? 0),
          losses:     Number(s?.losses  ?? 0),
          memory: Object.fromEntries(
            memory.filter((m) => m.role === e.role).map((m) => [m.kind, Number(m.n)])),
          routines: routines.filter((r) => r.role === e.role).length,
        };
      }),
    risk,
    funnel: leadFunnel,
    traffic,
    // Weighted edges for the who-talks-to-whom view. Built here rather than in
    // the page so the counts cannot drift from the list beside them.
    edges: Object.values(
      handoffs.reduce((acc: Record<string, any>, h) => {
        const k = `${h.fromRole ?? "—"}→${h.toRole}`;
        acc[k] ??= { from: h.fromRole, to: h.toRole, n: 0, lastReason: h.reason, at: h.createdAt };
        acc[k].n++;
        return acc;
      }, {}),
    ),
    alerts,
    routineRuns: lastRuns,
  });
});

/** Run the operations officer now rather than waiting for its sweep. */
router.post("/check", async (req, res) => res.json(await runOpsAgent(req.session.userId!)));

/** What it would decide right now, changing nothing. */
router.get("/preview", async (req, res) => {
  const signals = await gather(req.session.userId!);
  res.json({ signals, decision: decide(signals) });
});

/**
 * Take manual control.
 *
 * Marked `owner`, which stops the officer overwriting it for six hours. The
 * officer keeps reporting either way — it just does not quietly undo a person.
 */
router.patch("/controls", async (req, res) => {
  const userId = req.session.userId!;
  await getControls(userId);   // ensure the row exists

  const set: Record<string, unknown> = { setBy: "owner", updatedAt: new Date() };
  if (req.body?.throttle !== undefined) {
    const n = Number(req.body.throttle);
    // Below 1 would mean sending faster than the pacing maths intends, which is
    // not a control the owner gets either — that maths already targets the goal.
    set["throttle"] = String(Math.min(10, Math.max(1, Number.isFinite(n) ? n : 1)));
  }
  if (req.body?.dailyCeiling !== undefined) {
    const n = Number(req.body.dailyCeiling);
    set["dailyCeiling"] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  if (req.body?.holdMinutes !== undefined) {
    const n = Number(req.body.holdMinutes);
    set["holdUntil"] = Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 60_000) : null;
  }
  if (req.body?.reason !== undefined) set["reason"] = String(req.body.reason).trim().slice(0, 500) || null;

  const [row] = await db.update(opsControlsTable).set(set)
    .where(eq(opsControlsTable.userId, userId)).returning();
  res.json(row);
});

/** Hand control back, so the next sweep decides again. */
router.post("/controls/release", async (req, res) => {
  const userId = req.session.userId!;
  await getControls(userId);
  const [row] = await db.update(opsControlsTable)
    .set({ setBy: "agent", updatedAt: new Date(Date.now() - 7 * 60 * 60_000) })
    .where(eq(opsControlsTable.userId, userId)).returning();
  res.json(row);
});

router.post("/alerts/:id/ack", async (req, res) => {
  const [row] = await db.update(opsAlertsTable).set({ acknowledged: true })
    .where(and(eq(opsAlertsTable.id, parseInt(req.params.id!)), eq(opsAlertsTable.userId, req.session.userId!)))
    .returning();
  if (!row) return res.status(404).json({ error: "التنبيه غير موجود" });
  res.json(row);
});

/** The owner speaking to an employee, through the same bus they use. */
router.post("/say", async (req, res) => {
  const userId = req.session.userId!;
  const toRole = req.body?.toRole ? String(req.body.toRole) : null;
  const body = String(req.body?.body ?? "").trim();
  if (!body) return res.status(400).json({ error: "النص مطلوب" });

  if (toRole) {
    const [ok] = await db.select({ id: botEmployeesTable.id }).from(botEmployeesTable)
      .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, toRole))).limit(1);
    if (!ok) return res.status(404).json({ error: "الموظف غير موجود" });
  }

  await say({ userId, fromRole: "owner", toRole, kind: "directive", body });
  res.status(201).json({ ok: true });
});

export default router;
