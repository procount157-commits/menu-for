// ── /api/growth — the owner's levers for selling more and keeping customers ──

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, OWNER } from "../lib/tenancy/context";
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

export default router;
