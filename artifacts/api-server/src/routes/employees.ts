// ── Bot employees ─────────────────────────────────────────────────
// One endpoint per employee card: who they are, whether they are on duty, and
// what they actually did. The numbers come from the engines behind them rather
// than being stored twice, so a card cannot disagree with the system it
// describes.

import { Router } from "express";
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db, botEmployeesTable, businessProfileTable, knowledgeBaseTable,
  autoReplyLogTable, monitorReportsTable, followUpJobsTable, leadSourcesTable,
  DEFAULT_EMPLOYEES,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getStatus, getHealth } from "../lib/whatsapp";
import { getDailySentCount, getEffectiveDailyLimit } from "../lib/daily-limit";
import { runMonitorFor, MONITOR_INTERVAL_MS } from "../lib/monitor-agent";

const router = Router();
router.use(requireAuth);

/** Hire the defaults for an account that has none yet. */
async function ensureHired(userId: number) {
  const existing = await db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId));
  if (existing.length > 0) return existing;
  await db.insert(botEmployeesTable)
    .values(DEFAULT_EMPLOYEES.map((e) => ({ userId, ...e })))
    .onConflictDoNothing();
  return db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId));
}

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const employees = await ensureHired(userId);
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const week  = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const [
    [profile], [kb], [replies24], [replies7d], recentReplies, gapRows,
    [report], [followUps], [leads], used, limit,
  ] = await Promise.all([
    db.select().from(businessProfileTable).where(eq(businessProfileTable.userId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(knowledgeBaseTable)
      .where(and(eq(knowledgeBaseTable.userId, userId), eq(knowledgeBaseTable.isActive, true))),
    db.select({
      replied: sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is not null)`,
      silent:  sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is null)`,
    }).from(autoReplyLogTable).where(and(eq(autoReplyLogTable.userId, userId), gte(autoReplyLogTable.createdAt, since))),
    db.select({ replied: sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is not null)` })
      .from(autoReplyLogTable).where(and(eq(autoReplyLogTable.userId, userId), gte(autoReplyLogTable.createdAt, week))),
    db.select({ phone: autoReplyLogTable.phone, incoming: autoReplyLogTable.incoming, reply: autoReplyLogTable.reply, createdAt: autoReplyLogTable.createdAt })
      .from(autoReplyLogTable).where(and(eq(autoReplyLogTable.userId, userId), isNotNull(autoReplyLogTable.reply)))
      .orderBy(desc(autoReplyLogTable.createdAt)).limit(5),
    // Questions it went quiet on — the list that tells you what to write next.
    db.select({ incoming: autoReplyLogTable.incoming, n: sql<number>`count(*)` })
      .from(autoReplyLogTable)
      .where(and(eq(autoReplyLogTable.userId, userId), isNull(autoReplyLogTable.reply),
                 sql`${autoReplyLogTable.skipped} ~ 'لا توجد معلومة|تطابق ضعيف'`))
      .groupBy(autoReplyLogTable.incoming).orderBy(desc(sql`count(*)`)).limit(5),
    db.select().from(monitorReportsTable).where(eq(monitorReportsTable.userId, userId))
      .orderBy(desc(monitorReportsTable.createdAt)).limit(1),
    db.select({ pending: sql<number>`count(*) filter (where ${followUpJobsTable.status}='pending')` })
      .from(followUpJobsTable).where(eq(followUpJobsTable.userId, userId)),
    db.select({
      total: sql<number>`count(*)`,
      hot:   sql<number>`count(*) filter (where ${leadSourcesTable.lastIntent}='interested')`,
    }).from(leadSourcesTable).where(eq(leadSourcesTable.userId, userId)),
    getDailySentCount(userId),
    getEffectiveDailyLimit(userId),
  ]);

  const wa = getStatus(userId) as any;
  const health = getHealth(userId) as any;

  const byRole = Object.fromEntries(employees.map((e) => [e.role, e]));
  const nextCheckMin = report?.createdAt
    ? Math.max(0, Math.round((MONITOR_INTERVAL_MS - (Date.now() - new Date(report.createdAt).getTime())) / 60_000))
    : null;

  res.json({
    shared: {
      whatsappConnected: !!wa?.connected,
      whatsappStatus: wa?.status ?? "unknown",
      lastInboundAt: health?.lastInboundAt ?? null,
      dailyUsed: used, dailyLimit: limit,
      pendingFollowUps: Number(followUps?.pending ?? 0),
      leads: Number(leads?.total ?? 0),
      hotLeads: Number(leads?.hot ?? 0),
    },
    employees: [
      {
        ...byRole.sales,
        // A sales bot with no knowledge answers nothing, so "on duty" has to
        // mean both switched on and able to speak.
        onDuty: !!(byRole.sales?.isActive && profile?.autoReply && Number(kb?.n ?? 0) > 0),
        switchedOn: !!profile?.autoReply,
        stats: {
          knowledgeEntries: Number(kb?.n ?? 0),
          replied24h: Number(replies24?.replied ?? 0),
          silent24h:  Number(replies24?.silent ?? 0),
          replied7d:  Number(replies7d?.replied ?? 0),
        },
        recentReplies,
        knowledgeGaps: gapRows.filter((g) => g.incoming),
      },
      {
        ...byRole.monitor,
        onDuty: !!byRole.monitor?.isActive,
        switchedOn: true,
        intervalMinutes: MONITOR_INTERVAL_MS / 60_000,
        nextCheckMinutes: nextCheckMin,
        lastReport: report ?? null,
      },
    ],
  });
});

router.patch("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id!);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name  !== undefined) updates.name = String(req.body.name).trim().slice(0, 80);
  if (req.body?.title !== undefined) updates.title = String(req.body.title).trim().slice(0, 120);
  if (req.body?.isActive !== undefined) updates.isActive = !!req.body.isActive;

  const [row] = await db.update(botEmployeesTable).set(updates)
    .where(and(eq(botEmployeesTable.id, id), eq(botEmployeesTable.userId, userId))).returning();
  if (!row) return res.status(404).json({ error: "الموظف غير موجود" });

  // The sales employee's switch is the account's auto-reply flag; keeping two
  // separate switches would let the card and the engine disagree.
  if (row.role === "sales" && req.body?.isActive !== undefined) {
    await db.update(businessProfileTable).set({ autoReply: !!req.body.isActive, updatedAt: new Date() })
      .where(eq(businessProfileTable.userId, userId));
  }
  res.json(row);
});

router.post("/monitor/run", async (req, res) => res.json(await runMonitorFor(req.session.userId!)));

export default router;
