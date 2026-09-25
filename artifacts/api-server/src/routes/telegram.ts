// ── Telegram wiring ───────────────────────────────────────────────
// Linking is two steps because Telegram makes it two: a bot cannot open a
// conversation, so the owner messages it and only then does its chat id exist.

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, telegramSettingsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { verifyToken, saveToken, link, notify, getSettings } from "../lib/telegram";
import { runCollector, reassess, chaseList, SEGMENT_AR } from "../lib/collector-agent";
import { runCoach } from "../lib/coach-agent";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  if (!s) return res.json({ configured: false });
  // The token is never returned — only enough of it to recognise which one.
  res.json({
    configured: true,
    tokenHint: `${s.botToken.slice(0, 8)}…${s.botToken.slice(-4)}`,
    linked: !!s.chatId, chatTitle: s.chatTitle, enabled: s.enabled,
    linkedAt: s.linkedAt, lastError: s.lastError,
  });
});

router.post("/token", async (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return res.status(400).json({ error: "التوكن غير صالح — انسخه كاملاً من BotFather" });
  }
  try {
    const bot = await verifyToken(token);
    await saveToken(req.session.userId!, token);
    res.json({ ok: true, username: bot.username, name: bot.name });
  } catch (err: any) {
    res.status(400).json({ error: `تليجرام رفض التوكن: ${String(err?.message ?? err).slice(0, 120)}` });
  }
});

/** Called while the owner is looking at the "send /start" instruction. */
router.post("/link", async (req, res) => {
  try {
    res.json(await link(req.session.userId!));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err).slice(0, 160) });
  }
});

router.post("/test", async (req, res) => {
  const ok = await notify(req.session.userId!, "✅ الربط يعمل. ستصلك التقارير هنا.");
  res.json({ ok });
});

router.patch("/", async (req, res) => {
  const [row] = await db.update(telegramSettingsTable)
    .set({ enabled: !!req.body?.enabled, updatedAt: new Date() })
    .where(eq(telegramSettingsTable.userId, req.session.userId!)).returning();
  res.json(row ?? { error: "غير مضبوط" });
});

/** The collector's own view, for the dashboard. */
router.get("/segments", async (req, res) => {
  const userId = req.session.userId!;
  const counts = await reassess(userId);
  res.json({
    counts, labels: SEGMENT_AR,
    chase: await chaseList(userId, 15),
  });
});

router.post("/report/now", async (req, res) => res.json(await runCollector(req.session.userId!)));
router.post("/coach/now",  async (req, res) => res.json(await runCoach(req.session.userId!)));

export default router;
