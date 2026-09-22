import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getQr, initWhatsApp, getStatus, logout } from "../lib/whatsapp";
import { readSettings } from "../lib/settings";

const router = Router();

/**
 * Public uptime ping — no authentication required.
 * Use this URL with UptimeRobot / BetterUptime / any external monitor
 * to keep the server alive 24/7 and prevent Replit Autoscale scale-to-zero.
 *
 * Monitor URL: GET https://<your-domain>/api/ping
 * Recommended interval: every 5 minutes
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), uptime: Math.round(process.uptime()) });
});

router.get("/settings", (_req, res) => {
  const s = readSettings();
  res.json({
    whatsappNumber: s.whatsappNumber,
    heroTitleAr:    s.heroTitleAr,
    heroTitleEn:    s.heroTitleEn,
    heroSubAr:      s.heroSubAr,
    heroSubEn:      s.heroSubEn,
  });
});

/**
 * Public QR endpoint — no authentication required.
 * Used by the /wa/:token page so the subscriber can connect their WhatsApp
 * without needing to log in to the dashboard.
 *
 * ?force=1 → clears existing session for a fresh QR
 */
router.get("/whatsapp/qr-public/:token", async (req, res) => {
  const { token } = req.params;
  const force = req.query["force"] === "1";

  if (!token || token.length < 10) {
    return res.status(400).json({ error: "رمز غير صالح" });
  }

  const [user] = await db
    .select({
      id:          usersTable.id,
      qrDisabled:  usersTable.qrDisabled,
      currentQr:   usersTable.currentQr,
      qrExpiresAt: usersTable.qrExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.connectToken, token));

  if (!user) {
    return res.status(404).json({ error: "الرابط غير صالح أو منتهي الصلاحية" });
  }

  if (user.qrDisabled) {
    return res.status(403).json({ error: "ربط الواتساب معطّل لهذا الحساب. تواصل مع الدعم للتفعيل." });
  }

  // Force restart: clear session so user gets a fresh QR
  if (force) {
    try { await logout(user.id); } catch { /* ignore */ }
    await db.update(usersTable)
      .set({ currentQr: null, qrExpiresAt: null })
      .where(eq(usersTable.id, user.id));
    await new Promise((r) => setTimeout(r, 1_200));
  }

  // Start session if not already running (init() is now idempotent)
  const current = getStatus(user.id);
  if (current.status === "disconnected") {
    initWhatsApp(user.id).catch(() => {});
  }

  // Wait up to 5 s for a QR or connected state — polling every 200 ms.
  // This avoids returning null immediately when the socket just started.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const s = getStatus(user.id);
    const q = getQr(user.id);
    if (s.connected || q.qr) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const qrData = getQr(user.id);
  const status  = getStatus(user.id);

  // Fall back to DB-persisted QR (covers multi-instance / autoscale scenarios)
  let qrImage = qrData.qr;
  if (!qrImage && user.currentQr && user.qrExpiresAt && user.qrExpiresAt > new Date()) {
    qrImage = user.currentQr;
  }

  res.json({
    qr:        qrImage,
    status:    qrData.status,
    connected: status.connected,
    phone:     status.phone,
    name:      status.name,
  });
});

export default router;
