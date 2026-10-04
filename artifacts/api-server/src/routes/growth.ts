// ── /api/growth — the owner's levers for selling more and keeping customers ──

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, OWNER, MANAGERS } from "../lib/tenancy/context";
import { menuReport } from "../lib/growth/menu-stats";
import { menuPlan } from "../lib/plans";
import { branchesTable, menuStatsDailyTable, customersTable } from "@workspace/db";
import { birthdayPrefs } from "../lib/growth/birthday";
import { referralOn, referralPrefs, referralStats } from "../lib/growth/referrals";
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

// ── Birthday gift ─────────────────────────────────────────────────

router.get("/growth/birthday", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const year = new Date().getFullYear();
  const [c] = await db.select({
    known: sql<number>`count(*) filter (where birth_month is not null)::int`,
    sent: sql<number>`count(*) filter (where birthday_sent_year = ${year})::int`,
  }).from(customersTable).where(eq(customersTable.orgId, t.org.id));
  const plan = await menuPlan(t.org.ownerUserId);
  res.json({ enabled: !!t.org.features?.birthday, prefs: birthdayPrefs(t.org), known: c?.known ?? 0, sentThisYear: c?.sent ?? 0, allowed: plan.features.marketing, planName: plan.planName });
}));

router.patch("/growth/birthday", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const b = req.body ?? {};
  if (b.enabled === true) {
    const plan = await menuPlan(t.org.ownerUserId);
    if (!plan.features.marketing) return res.status(402).json({ error: `هدية عيد الميلاد من خطة «احترافي» — خطتك ${plan.planName}.`, plan: true });
  }
  const features = { ...(t.org.features ?? {}), ...(typeof b.enabled === "boolean" ? { birthday: b.enabled } : {}) };
  const cur = birthdayPrefs(t.org);
  const pct = Number.isFinite(Number(b.pct)) ? Math.max(5, Math.min(50, Math.round(Number(b.pct)))) : cur.pct;
  const days = Number.isFinite(Number(b.days)) ? Math.max(1, Math.min(30, Math.round(Number(b.days)))) : cur.days;
  const growthPrefs = { ...(t.org.growthPrefs ?? {}), birthday: { pct, days } };
  await db.update(orgsTable).set({ features, growthPrefs }).where(eq(orgsTable.id, t.org.id));
  res.json({ enabled: !!features.birthday, prefs: { pct, days } });
}));

// ── «ادعُ صديقاً» ─────────────────────────────────────────────────

router.get("/growth/referral", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  const plan = await menuPlan(t.org.ownerUserId);
  res.json({ enabled: referralOn(t.org), prefs: referralPrefs(t.org), stats: await referralStats(t.org.id), allowed: plan.features.growth, planName: plan.planName });
}));

router.patch("/growth/referral", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const b = req.body ?? {};
  if (b.enabled === true) {
    const plan = await menuPlan(t.org.ownerUserId);
    if (!plan.features.growth) return res.status(402).json({ error: `«ادعُ صديقاً» من خطة «أعمال» — خطتك ${plan.planName}.`, plan: true });
  }
  const cur = referralPrefs(t.org);
  const num = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  const referral = { friendPct: num(b.friendPct, 5, 50, cur.friendPct), rewardPct: num(b.rewardPct, 5, 50, cur.rewardPct), rewardDays: num(b.rewardDays, 7, 90, cur.rewardDays) };
  const features = { ...(t.org.features ?? {}), ...(typeof b.enabled === "boolean" ? { referral: b.enabled } : {}) };
  await db.update(orgsTable).set({ features, growthPrefs: { ...(t.org.growthPrefs ?? {}), referral } }).where(eq(orgsTable.id, t.org.id));
  res.json({ enabled: !!features.referral, prefs: referral });
}));

export default router;
