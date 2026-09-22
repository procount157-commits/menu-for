import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  trackingPixelsTable,
  trackingLinksTable,
  trackingEventsTable,
  campaignsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ── Pixel configs ─────────────────────────────────────────────────

router.get("/pixels", async (req, res) => {
  const userId = req.session.userId!;
  const pixels = await db
    .select()
    .from(trackingPixelsTable)
    .where(eq(trackingPixelsTable.userId, userId));
  res.json(pixels);
});

router.post("/pixels", async (req, res) => {
  const userId = req.session.userId!;
  const { platform, pixelId, accessToken, testCode, enabled } = req.body;

  if (!platform || !pixelId || !accessToken)
    return res.status(400).json({ error: "platform و pixelId و accessToken مطلوبة" });

  if (!["meta", "snapchat", "tiktok"].includes(platform))
    return res.status(400).json({ error: "المنصة غير صحيحة" });

  const [row] = await db
    .insert(trackingPixelsTable)
    .values({ userId, platform, pixelId, accessToken, testCode: testCode || null, enabled: enabled !== false })
    .onConflictDoUpdate({
      target: [trackingPixelsTable.userId, trackingPixelsTable.platform],
      set: { pixelId, accessToken, testCode: testCode || null, enabled: enabled !== false },
    })
    .returning();

  res.json(row);
});

router.delete("/pixels/:id", async (req, res) => {
  const userId = req.session.userId!;
  await db
    .delete(trackingPixelsTable)
    .where(and(eq(trackingPixelsTable.id, parseInt(req.params.id)), eq(trackingPixelsTable.userId, userId)));
  res.json({ success: true });
});

// ── Tracking links ────────────────────────────────────────────────

router.get("/links", async (req, res) => {
  const userId = req.session.userId!;
  const links = await db
    .select({
      id: trackingLinksTable.id,
      code: trackingLinksTable.code,
      title: trackingLinksTable.title,
      originalUrl: trackingLinksTable.originalUrl,
      campaignId: trackingLinksTable.campaignId,
      campaignName: campaignsTable.name,
      clicks: trackingLinksTable.clicks,
      createdAt: trackingLinksTable.createdAt,
    })
    .from(trackingLinksTable)
    .leftJoin(campaignsTable, eq(trackingLinksTable.campaignId, campaignsTable.id))
    .where(eq(trackingLinksTable.userId, userId))
    .orderBy(desc(trackingLinksTable.createdAt));

  res.json(links);
});

router.post("/links", async (req, res) => {
  const userId = req.session.userId!;
  const { title, originalUrl, campaignId } = req.body;

  if (!title || !originalUrl)
    return res.status(400).json({ error: "العنوان والرابط مطلوبان" });

  // Validate URL
  try { new URL(originalUrl); } catch {
    return res.status(400).json({ error: "الرابط غير صحيح" });
  }

  const code = crypto.randomBytes(4).toString("hex"); // 8-char hex code
  const [link] = await db
    .insert(trackingLinksTable)
    .values({
      userId,
      code,
      title,
      originalUrl,
      campaignId: campaignId ? parseInt(campaignId) : null,
    })
    .returning();

  res.status(201).json(link);
});

router.delete("/links/:id", async (req, res) => {
  const userId = req.session.userId!;
  await db
    .delete(trackingLinksTable)
    .where(and(eq(trackingLinksTable.id, parseInt(req.params.id)), eq(trackingLinksTable.userId, userId)));
  res.json({ success: true });
});

// ── Events log ────────────────────────────────────────────────────

router.get("/events", async (req, res) => {
  const userId = req.session.userId!;
  const limit = Math.min(parseInt(String(req.query.limit ?? "100")), 500);

  const events = await db
    .select({
      id:          trackingEventsTable.id,
      phone:       trackingEventsTable.phone,
      ip:          trackingEventsTable.ip,
      metaFired:   trackingEventsTable.metaFired,
      snapFired:   trackingEventsTable.snapFired,
      tiktokFired: trackingEventsTable.tiktokFired,
      clickedAt:   trackingEventsTable.clickedAt,
      linkTitle:   trackingLinksTable.title,
      linkCode:    trackingLinksTable.code,
      originalUrl: trackingLinksTable.originalUrl,
    })
    .from(trackingEventsTable)
    .innerJoin(trackingLinksTable, eq(trackingEventsTable.linkId, trackingLinksTable.id))
    .where(eq(trackingEventsTable.userId, userId))
    .orderBy(desc(trackingEventsTable.clickedAt))
    .limit(limit);

  res.json(events);
});

// ── Stats per link ────────────────────────────────────────────────

router.get("/stats", async (req, res) => {
  const userId = req.session.userId!;
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(trackingEventsTable)
    .where(eq(trackingEventsTable.userId, userId));

  const [linksRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(trackingLinksTable)
    .where(eq(trackingLinksTable.userId, userId));

  res.json({
    totalClicks: Number(totalRow?.total ?? 0),
    totalLinks: Number(linksRow?.total ?? 0),
  });
});

// ── Dashboard aggregated stats ────────────────────────────────────

router.get("/dashboard", async (req, res) => {
  const userId = req.session.userId!;

  // Clicks per day — last 30 days
  const clicksByDay = await db.execute(sql`
    SELECT DATE(clicked_at) AS date, COUNT(*) AS count
    FROM tracking_events te
    INNER JOIN tracking_links tl ON tl.id = te.link_id
    WHERE tl.user_id = ${userId}
      AND te.clicked_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(clicked_at)
    ORDER BY DATE(clicked_at)
  `);

  // Platform stats
  const platformStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE te.meta_fired)   AS meta_fired,
      COUNT(*) FILTER (WHERE te.snap_fired)   AS snap_fired,
      COUNT(*) FILTER (WHERE te.tiktok_fired) AS tiktok_fired,
      COUNT(*)                                 AS total
    FROM tracking_events te
    INNER JOIN tracking_links tl ON tl.id = te.link_id
    WHERE tl.user_id = ${userId}
  `);

  // Top links
  const topLinks = await db
    .select({
      id: trackingLinksTable.id,
      code: trackingLinksTable.code,
      title: trackingLinksTable.title,
      originalUrl: trackingLinksTable.originalUrl,
      clicks: trackingLinksTable.clicks,
    })
    .from(trackingLinksTable)
    .where(eq(trackingLinksTable.userId, userId))
    .orderBy(desc(trackingLinksTable.clicks))
    .limit(5);

  const row = (platformStats.rows ?? platformStats)[0] as any;

  res.json({
    clicksByDay: (clicksByDay.rows ?? clicksByDay) as { date: string; count: number }[],
    platformStats: {
      meta:     { fired: Number(row?.meta_fired ?? 0),   total: Number(row?.total ?? 0) },
      snapchat: { fired: Number(row?.snap_fired ?? 0),   total: Number(row?.total ?? 0) },
      tiktok:   { fired: Number(row?.tiktok_fired ?? 0), total: Number(row?.total ?? 0) },
    },
    topLinks,
  });
});

export default router;

// ── Public redirect handler (exported separately for app.ts) ──────
// Registered at /t/:code — no auth required

export async function handleTrackingRedirect(req: any, res: any) {
  const { code } = req.params;
  const phone = (req.query.p as string) || null;

  const [link] = await db
    .select()
    .from(trackingLinksTable)
    .where(eq(trackingLinksTable.code, code))
    .limit(1);

  if (!link) return res.status(404).send("رابط غير موجود");

  const ip        = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
  const userAgent = req.headers["user-agent"] || "";
  const referer   = req.headers["referer"] || "";

  // Increment clicks counter (fire-and-forget)
  db.update(trackingLinksTable)
    .set({ clicks: sql`${trackingLinksTable.clicks} + 1` })
    .where(eq(trackingLinksTable.id, link.id))
    .catch(() => {});

  // Load user's pixel configs
  const pixels = await db
    .select()
    .from(trackingPixelsTable)
    .where(and(eq(trackingPixelsTable.userId, link.userId), eq(trackingPixelsTable.enabled, true)))
    .catch(() => [] as typeof trackingPixelsTable.$inferSelect[]);

  const eventTime = Math.floor(Date.now() / 1000);
  const sourceUrl = `${req.protocol}://${req.get("host")}/t/${code}`;

  // SHA-256 hash helper for PII
  const sha256 = (v: string) => crypto.createHash("sha256").update(v.toLowerCase().trim()).digest("hex");

  let metaFired = false, snapFired = false, tiktokFired = false;

  const firing = pixels.map(async (px) => {
    try {
      if (px.platform === "meta") {
        const userData: Record<string, string> = {
          client_ip_address: ip,
          client_user_agent: userAgent,
        };
        if (phone) userData["ph"] = sha256(phone);

        const body: any = {
          data: [{
            event_name: "Lead",
            event_time: eventTime,
            event_source_url: sourceUrl,
            action_source: "website",
            user_data: userData,
          }],
          access_token: px.accessToken,
        };
        if (px.testCode) body.test_event_code = px.testCode;

        const r = await fetch(
          `https://graph.facebook.com/v18.0/${px.pixelId}/events`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        if (r.ok) metaFired = true;
        else logger.warn({ status: r.status, platform: "meta" }, "Pixel fire failed");
      }

      if (px.platform === "tiktok") {
        const body: any = {
          pixel_code: px.pixelId,
          event: "ClickButton",
          event_time: eventTime,
          context: {
            user_agent: userAgent,
            ip,
            page: { url: sourceUrl },
          },
          properties: {},
        };
        if (phone) body.context.user = { phone_number: sha256(phone) };

        const r = await fetch(
          "https://business-api.tiktok.com/open_api/v1.3/event/track/",
          { method: "POST", headers: { "Content-Type": "application/json", "Access-Token": px.accessToken }, body: JSON.stringify(body) }
        );
        if (r.ok) tiktokFired = true;
        else logger.warn({ status: r.status, platform: "tiktok" }, "Pixel fire failed");
      }

      if (px.platform === "snapchat") {
        const body: any = {
          pixel_id: px.pixelId,
          event_type: "PAGE_VIEW",
          event_conversion_type: "WEB",
          timestamp: new Date().toISOString(),
          hashed_ip_address: sha256(ip),
          user_agent: userAgent,
          page_url: sourceUrl,
        };
        if (phone) body.hashed_phone_number = sha256(phone);

        const r = await fetch(
          "https://tr.snapchat.com/v2/conversion",
          { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${px.accessToken}` }, body: JSON.stringify(body) }
        );
        if (r.ok) snapFired = true;
        else logger.warn({ status: r.status, platform: "snapchat" }, "Pixel fire failed");
      }
    } catch (err) {
      logger.error({ err, platform: px.platform }, "Pixel fire error");
    }
  });

  await Promise.allSettled(firing);

  // Log the event
  db.insert(trackingEventsTable)
    .values({ linkId: link.id, userId: link.userId, phone, ip, userAgent, referer, metaFired, snapFired, tiktokFired })
    .catch(() => {});

  // Redirect
  res.redirect(302, link.originalUrl);
}
