// ── /api/wa-auto — WhatsApp as the shop runs it ───────────────────
// One place for everything automatic on the shop's number: what is being
// sent and whether it arrived and was opened, the protection in force, the
// shop's own alert phones, the auto-reply switch, the weekly campaign and
// the audiences it can reach.

import { Router } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, branchesTable, businessProfileTable, notificationsTable, campaignsTable, knowledgeBaseTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, OWNER } from "../lib/tenancy/context";
import { getStatus } from "../lib/whatsapp";
import { getControls, gather } from "../lib/ops-agent";
import { scoreRisk, RISK_LEVEL_AR } from "../lib/risk";
import { numberAgeDays, getDailySentCount, getEffectiveDailyLimit } from "../lib/daily-limit";
import { sentToday, CONSENTED_DAILY_CAP, REPLIED_DAILY_CAP } from "../lib/notify/outbox";
import { cleanAlertPhones } from "../lib/notify/alerts";
import { getAutopilot, cleanAutopilotPatch, runAutopilot, approveRun, rejectRun, recentRuns } from "../lib/wa-auto/autopilot";
import { segmentCounts, audience, toList, retargetPhones, isSegment, isRetarget, SEGMENTS, RETARGETS } from "../lib/wa-auto/audience";
import { waAutopilotTable } from "@workspace/db";
import { menuPlan } from "../lib/plans";
import { resolveProvider } from "../lib/llm";

const router = Router();

router.get("/wa-auto", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const uid = t.waUserId;
  const wa = getStatus(uid) as { connected?: boolean; status?: string; phone?: string | null };
  const since7 = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [controls, signals, age, sent, limit, replied, consented, staff, cfg, runs, segs, profile, plan, model, kb] = await Promise.all([
    getControls(uid).catch(() => null),
    gather(uid).catch(() => null),
    numberAgeDays(uid).catch(() => 0),
    getDailySentCount(uid).catch(() => 0),
    getEffectiveDailyLimit(uid).catch(() => 0),
    sentToday(uid, "replied"), sentToday(uid, "consented"), sentToday(uid, "staff"),
    getAutopilot(t.org, uid),
    recentRuns(uid, 12),
    segmentCounts(t.org.id),
    db.select().from(businessProfileTable).where(eq(businessProfileTable.userId, uid)).limit(1),
    menuPlan(t.org.ownerUserId),
    resolveProvider().catch(() => null),
    db.select({ n: sql<number>`count(*)::int` }).from(knowledgeBaseTable).where(eq(knowledgeBaseTable.userId, uid)),
  ]);
  const risk = signals?.risk ? scoreRisk(signals.risk) : null;
  // What went out this week, by kind: sent, arrived, opened — and what did not go, and why.
  const funnel = await db.select({
    kind: notificationsTable.kind,
    sent: sql<number>`count(*) filter (where status = 'sent')::int`,
    delivered: sql<number>`count(*) filter (where delivered_at is not null)::int`,
    read: sql<number>`count(*) filter (where read_at is not null)::int`,
    skipped: sql<number>`count(*) filter (where status = 'skipped')::int`,
    failed: sql<number>`count(*) filter (where status = 'failed')::int`,
  }).from(notificationsTable).where(and(eq(notificationsTable.waUserId, uid), gte(notificationsTable.createdAt, since7))).groupBy(notificationsTable.kind);
  const reasons = await db.select({ reason: notificationsTable.reason, n: sql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.waUserId, uid), gte(notificationsTable.createdAt, since7), eq(notificationsTable.status, "skipped"))).groupBy(notificationsTable.reason);
  const [camp] = await db.select({
    campaigns: sql<number>`count(*)::int`,
    sent: sql<number>`coalesce(sum(sent_count), 0)::int`, delivered: sql<number>`coalesce(sum(delivered_count), 0)::int`, read: sql<number>`coalesce(sum(read_count), 0)::int`,
  }).from(campaignsTable).where(and(eq(campaignsTable.userId, uid), gte(campaignsTable.createdAt, new Date(Date.now() - 30 * 24 * 3_600_000))));

  res.json({
    whatsapp: { connected: !!wa?.connected, status: wa?.status ?? "disconnected", phone: wa?.phone ?? null, numberAgeDays: Math.round(age * 10) / 10 },
    plan: { name: plan.planName, notify: plan.features.notify, marketing: plan.features.marketing },
    protection: {
      risk: risk ? { score: risk.score, level: risk.level, levelAr: RISK_LEVEL_AR[risk.level], reasons: (risk as any).reasons ?? (risk as any).factors ?? [] } : null,
      throttle: Number(controls?.throttle ?? 1), dailyCeiling: controls?.dailyCeiling ?? null,
      holdUntil: controls?.holdUntil && controls.holdUntil > new Date() ? controls.holdUntil : null, holdReason: controls?.reason ?? null,
      campaigns: { sentToday: sent, dailyLimit: limit },
      lanes: {
        replied: { sentToday: replied, cap: REPLIED_DAILY_CAP },
        consented: { sentToday: consented, cap: Math.min(CONSENTED_DAILY_CAP, controls?.dailyCeiling ?? Infinity, Math.max(20, limit)) },
        staff: { sentToday: staff },
      },
    },
    notifications: { funnel, skippedReasons: reasons },
    campaigns30d: camp,
    alerts: { phones: t.branch.alertPhones ?? [] },
    agent: { autoReply: !!profile[0]?.autoReply, model: model ? model.provider : null, knowledgeEntries: kb[0]?.n ?? 0 },
    autopilot: cfg,
    runs,
    segments: (Object.keys(SEGMENTS) as Array<keyof typeof SEGMENTS>).map((k) => ({ key: k, label: SEGMENTS[k].ar, count: segs[k] })),
    retargets: (Object.keys(RETARGETS) as Array<keyof typeof RETARGETS>).map((k) => ({ key: k, label: RETARGETS[k].ar })),
  });
}));

router.patch("/wa-auto/alerts", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const phones = cleanAlertPhones(req.body?.phones);
  await db.update(branchesTable).set({ alertPhones: phones }).where(eq(branchesTable.id, t.branch.id));
  res.json({ phones });
}));

/** The auto-reply switch: the host answers customers from the menu and the knowledge base. */
router.patch("/wa-auto/auto-reply", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const on = !!req.body?.enabled;
  await db.insert(businessProfileTable).values({ userId: t.waUserId, name: t.org.name, autoReply: on })
    .onConflictDoUpdate({ target: businessProfileTable.userId, set: { autoReply: on, updatedAt: new Date() } });
  res.json({ autoReply: on });
}));

router.patch("/wa-auto/autopilot", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const patch = cleanAutopilotPatch(req.body ?? {});
  if (patch.enabled) {
    const plan = await menuPlan(t.org.ownerUserId);
    if (!plan.features.marketing) return res.status(402).json({ error: `الحملة الأسبوعية غير متاحة في خطة ${plan.planName} — رقّ الخطة لتفعيلها.`, plan: true });
  }
  await getAutopilot(t.org, t.waUserId);
  const [row] = await db.update(waAutopilotTable).set({ ...patch, updatedAt: new Date() }).where(eq(waAutopilotTable.waUserId, t.waUserId)).returning();
  res.json(row);
}));

/** Prepare this week's campaign now; it waits for approval whatever the mode. */
router.post("/wa-auto/autopilot/run", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const run = await runAutopilot(t.waUserId, { manual: true });
  if (!run) return res.status(400).json({ error: "تعذّر تجهيز الحملة" });
  res.json(run);
}));

router.post("/wa-auto/runs/:id/approve", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const r = await approveRun(t.waUserId, Number(req.params.id), req.body?.message);
  if (!r.ok) return res.status(409).json({ error: r.reason ?? "تعذّر بدء الحملة" });
  res.json({ ok: true });
}));

router.post("/wa-auto/runs/:id/reject", requireAuth, withTenant(OWNER, async (req, res, t) => {
  if (!(await rejectRun(t.waUserId, Number(req.params.id)))) return res.status(409).json({ error: "هذه الحملة لم تعد بانتظار الموافقة" });
  res.json({ ok: true });
}));

/** A customer segment as a contact list, ready for «حملة جديدة». */
router.post("/wa-auto/segment-list", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const seg = req.body?.segment;
  if (!isSegment(seg)) return res.status(400).json({ error: "شريحة غير معروفة" });
  const people = await audience(t.org, t.waUserId, seg, { restDays: Number(req.body?.restDays) || 0 });
  if (!people.length) return res.status(400).json({ error: "لا يوجد زبائن في هذه الشريحة وافقوا على العروض بعد" });
  const r = await toList(t.waUserId, `زبائن ${t.org.name} — ${SEGMENTS[seg].ar}`, "من منيو فور يو: زبائن وافقوا على استلام العروض", people);
  res.json({ groupId: r.groupId, added: r.added, total: people.length });
}));

/** People from a finished campaign who did not open it, opened without replying, or never got it. */
router.post("/wa-auto/retarget", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const who = req.body?.who, campaignId = Number(req.body?.campaignId);
  if (!isRetarget(who) || !campaignId) return res.status(400).json({ error: "اختر الحملة ومن تعيد استهدافهم" });
  const people = await retargetPhones(t.waUserId, campaignId, who);
  if (people === null) return res.status(404).json({ error: "الحملة غير موجودة" });
  if (!people.length) return res.status(400).json({ error: "لا أحد في هذه الفئة" });
  const r = await toList(t.waUserId, `إعادة استهداف — حملة ${campaignId} — ${RETARGETS[who].ar}`, "من نتائج حملة سابقة", people, { fresh: true });
  res.json({ groupId: r.groupId, total: people.length });
}));

router.get("/wa-auto/campaigns", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const rows = await db.select({
    id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status, createdAt: campaignsTable.createdAt,
    sent: campaignsTable.sentCount, delivered: campaignsTable.deliveredCount, read: campaignsTable.readCount, total: campaignsTable.totalCount,
  }).from(campaignsTable).where(eq(campaignsTable.userId, t.waUserId)).orderBy(sql`${campaignsTable.id} desc`).limit(30);
  res.json(rows);
}));

export default router;
