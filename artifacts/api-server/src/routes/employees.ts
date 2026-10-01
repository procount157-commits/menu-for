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
  agentHandoffsTable, conversationOwnerTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getStatus, getHealth } from "../lib/whatsapp";
import { getDailySentCount, getEffectiveDailyLimit } from "../lib/daily-limit";
import { runMonitorFor, MONITOR_INTERVAL_MS } from "../lib/monitor-agent";
import { shopRoster, refreshUntouchedPersonas } from "../lib/provision";

const router = Router();
router.use(requireAuth);

/** Intents an employee may claim. Mirrors the classifier's own vocabulary. */
const ROUTABLE = ["interested", "question", "greeting", "unclear", "complaint", "not_interested"];

/** Roles that are not free-form: the engine looks them up by name. */
const RESERVED_ROLES = new Set(["monitor"]);

/** Hire the defaults for an account that has none yet. */
async function ensureHired(userId: number) {
  const existing = await db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId));
  if (existing.length > 0) {
    if (!(await refreshUntouchedPersonas(userId, existing))) return existing;
    return db.select().from(botEmployeesTable).where(eq(botEmployeesTable.userId, userId));
  }
  await db.insert(botEmployeesTable)
    .values(shopRoster(userId))
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

  // Each employee's own numbers, and who they passed work to. Grouped in two
  // queries rather than two per employee, so hiring a tenth agent does not
  // cost ten more round trips.
  const [perAgent, handoffs, recentHandoffs, owners] = await Promise.all([
    db.select({
      role:     autoReplyLogTable.agentRole,
      replied:  sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is not null)`,
      silent:   sql<number>`count(*) filter (where ${autoReplyLogTable.reply} is null)`,
    }).from(autoReplyLogTable)
      .where(and(eq(autoReplyLogTable.userId, userId), gte(autoReplyLogTable.createdAt, since)))
      .groupBy(autoReplyLogTable.agentRole),
    db.select({
      from: agentHandoffsTable.fromRole, to: agentHandoffsTable.toRole,
      n: sql<number>`count(*)`,
    }).from(agentHandoffsTable)
      .where(and(eq(agentHandoffsTable.userId, userId), gte(agentHandoffsTable.createdAt, week)))
      .groupBy(agentHandoffsTable.fromRole, agentHandoffsTable.toRole),
    db.select().from(agentHandoffsTable).where(eq(agentHandoffsTable.userId, userId))
      .orderBy(desc(agentHandoffsTable.createdAt)).limit(8),
    db.select({ role: conversationOwnerTable.role, n: sql<number>`count(*)` })
      .from(conversationOwnerTable).where(eq(conversationOwnerTable.userId, userId))
      .groupBy(conversationOwnerTable.role),
  ]);
  const agentStats = new Map(perAgent.map((r) => [r.role ?? "", r]));
  const holding    = new Map(owners.map((r) => [r.role, Number(r.n)]));

  const wa = getStatus(userId) as any;
  const health = getHealth(userId) as any;

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
    // Built from the roster rather than a fixed pair, so an employee the owner
    // hires appears here without a code change.
    employees: employees
      .sort((a, b) => (a.kind === b.kind ? a.priority - b.priority : a.kind === "customer" ? -1 : 1))
      .map((e) => {
        const mine = agentStats.get(e.role);
        const base = {
          ...e,
          holdingConversations: holding.get(e.role) ?? 0,
          handedOut: handoffs.filter((h) => h.from === e.role).map((h) => ({ to: h.to, n: Number(h.n) })),
          handedIn:  handoffs.filter((h) => h.to   === e.role).map((h) => ({ from: h.from, n: Number(h.n) })),
        };

        if (e.kind === "internal") {
          return {
            ...base,
            onDuty: e.isActive, switchedOn: true,
            intervalMinutes: MONITOR_INTERVAL_MS / 60_000,
            nextCheckMinutes: nextCheckMin,
            lastReport: report ?? null,
          };
        }

        // A customer-facing agent with no knowledge answers nothing, so "on
        // duty" has to mean both switched on and able to speak.
        return {
          ...base,
          onDuty: !!(e.isActive && profile?.autoReply && Number(kb?.n ?? 0) > 0),
          switchedOn: !!profile?.autoReply,
          stats: {
            knowledgeEntries: Number(kb?.n ?? 0),
            replied24h: Number(mine?.replied ?? 0),
            silent24h:  Number(mine?.silent  ?? 0),
            // Kept account-wide: it is the seven-day trend of the whole desk,
            // and splitting it per agent before agent_role existed would show
            // zeros for history that predates the column.
            replied7d:  Number(replies7d?.replied ?? 0),
          },
          // The sales agent owns the shared views: the reply samples and the
          // gaps are about the knowledge base, which the whole team shares.
          ...(e.role === "sales" ? { recentReplies, knowledgeGaps: gapRows.filter((g) => g.incoming) } : {}),
        };
      }),
    recentHandoffs,
  });
});

router.patch("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id!);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name  !== undefined) updates.name = String(req.body.name).trim().slice(0, 80);
  if (req.body?.title !== undefined) updates.title = String(req.body.title).trim().slice(0, 120);
  if (req.body?.isActive !== undefined) updates.isActive = !!req.body.isActive;
  if (req.body?.persona !== undefined) {
    const v = String(req.body.persona).trim();
    updates.persona = v ? v.slice(0, 1_500) : null;
  }
  if (req.body?.specialties !== undefined) {
    // Only intents the classifier can actually produce; anything else would
    // silently never route and look like a broken switch.
    const want: string[] = Array.isArray(req.body.specialties) ? req.body.specialties.map(String) : [];
    updates.specialties = want.filter((v) => ROUTABLE.includes(v));
  }
  if (req.body?.priority !== undefined) {
    const n = Number(req.body.priority);
    if (Number.isFinite(n)) updates.priority = Math.min(999, Math.max(1, Math.round(n)));
  }

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

/** Hire someone new. The role is the routing key, so it has to be unique. */
router.post("/", async (req, res) => {
  const userId = req.session.userId!;
  const name = String(req.body?.name ?? "").trim().slice(0, 80);
  const role = String(req.body?.role ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  if (!name) return res.status(400).json({ error: "الاسم مطلوب" });
  if (!role) return res.status(400).json({ error: "المعرّف مطلوب (أحرف إنجليزية)" });
  if (RESERVED_ROLES.has(role)) return res.status(400).json({ error: "هذا المعرّف محجوز" });

  const [clash] = await db.select({ id: botEmployeesTable.id }).from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, role))).limit(1);
  if (clash) return res.status(409).json({ error: "يوجد موظف بهذا المعرّف" });

  const want = Array.isArray(req.body?.specialties) ? req.body.specialties.map(String) : [];
  const [row] = await db.insert(botEmployeesTable).values({
    userId, name, role, kind: "customer",
    title:  String(req.body?.title ?? "").trim().slice(0, 120) || null,
    avatar: String(req.body?.avatar ?? "🙂").slice(0, 8),
    persona: String(req.body?.persona ?? "").trim().slice(0, 1_500) || null,
    specialties: want.filter((v: string) => ROUTABLE.includes(v)),
    priority: Math.min(999, Math.max(1, Math.round(Number(req.body?.priority ?? 50)) || 50)),
    isActive: true,
  } as any).returning();
  res.status(201).json(row);
});

/**
 * Let someone go. Threads they were holding are released rather than deleted,
 * so the next message is routed afresh instead of vanishing into a role that
 * no longer exists.
 */
router.delete("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id!);
  const [row] = await db.select().from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.id, id), eq(botEmployeesTable.userId, userId))).limit(1);
  if (!row) return res.status(404).json({ error: "الموظف غير موجود" });
  if (RESERVED_ROLES.has(row.role)) return res.status(400).json({ error: "لا يمكن إنهاء هذا الموظف" });

  await db.delete(conversationOwnerTable)
    .where(and(eq(conversationOwnerTable.userId, userId), eq(conversationOwnerTable.role, row.role)));
  await db.delete(botEmployeesTable).where(eq(botEmployeesTable.id, id));
  res.json({ ok: true });
});

router.post("/monitor/run", async (req, res) => res.json(await runMonitorFor(req.session.userId!)));

export default router;
