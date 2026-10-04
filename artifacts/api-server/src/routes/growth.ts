// ── /api/growth — the owner's levers for selling more and keeping customers ──

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, OWNER, MANAGERS } from "../lib/tenancy/context";
import { menuReport } from "../lib/growth/menu-stats";
import { menuPlan } from "../lib/plans";
import { branchesTable, menuStatsDailyTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanReviewUrl, reviewStats } from "../lib/growth/reviews";
import { buildReport, sendReport, recentReports, cleanPrefs, recipients, DEFAULT_PREFS } from "../lib/growth/weekly-report";

const router = Router();

// ── The weekly report ─────────────────────────────────────────────

router.get("/growth/report", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const { stats, text, branch } = await buildReport(t.org);
  res.json({
    prefs: { ...DEFAULT_PREFS, ...(t.org.reportPrefs ?? {}) },
    preview: text, stats,
    recipients: branch ? await recipients(t.org, branch) : [],
    recent: (await recentReports(t.org.id)).map((r) => ({ id: r.id, weekStart: r.weekStart, sentTo: r.sentTo, manual: !!r.manual, createdAt: r.createdAt, text: r.text })),
  });
}));

router.patch("/growth/report", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const prefs = cleanPrefs(req.body, t.org.reportPrefs);
  await db.update(orgsTable).set({ reportPrefs: prefs }).where(eq(orgsTable.id, t.org.id));
  res.json({ prefs });
}));

router.post("/growth/report/send", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const r = await sendReport(t.org, { manual: true });
  if (!r.ok) return res.status(409).json({ error: r.reason });
  if (!r.to.length) return res.status(400).json({ error: "لا يوجد رقم يصله التقرير — أضف رقمك في «تنبيهات المحل» في «واتساب الآلي»." });
  res.json({ ok: true, to: r.to });
}));

// ── Google reviews ────────────────────────────────────────────────

router.get("/growth/reviews", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  res.json({ url: t.org.googleReviewUrl, enabled: !!t.org.features?.reviews, stats: await reviewStats(t.org.id) });
}));

router.patch("/growth/reviews", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const raw = String(req.body?.url ?? "").trim();
  const url = raw ? cleanReviewUrl(raw) : null;
  if (raw && !url) return res.status(400).json({ error: "هذا ليس رابط Google — انسخ رابط «اطلب تقييمات» من ملفك التجاري على Google." });
  await db.update(orgsTable).set({ googleReviewUrl: url }).where(eq(orgsTable.id, t.org.id));
  res.json({ url });
}));

// ── Menu analytics (business plan; counted on every plan) ─────────

router.get("/growth/menu-stats", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  let branchIds = t.role === "owner" ? (await db.select({ id: branchesTable.id }).from(branchesTable).where(eq(branchesTable.orgId, t.org.id))).map((b) => b.id) : t.branchIds;
  const only = Number(req.query.branch);
  if (only && branchIds.includes(only)) branchIds = [only];
  const plan = await menuPlan(t.org.ownerUserId);
  if (!plan.features.growth) {
    // Counting runs on every plan, so an upgrade opens months of history, not an empty page.
    const [c] = await db.select({ views: sql<number>`coalesce(sum(views), 0)::int` }).from(menuStatsDailyTable).where(eq(menuStatsDailyTable.orgId, t.org.id));
    return res.json({ locked: true, planName: plan.planName, recorded: c?.views ?? 0 });
  }
  res.json({ locked: false, ...(await menuReport(t.org, branchIds, days)) });
}));

export default router;
