import { Router } from "express";
import { db, campaignsTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { sendMessage } from "../lib/whatsapp";

const router = Router();
router.use(requireAuth);

// ── No-reply contacts for a campaign ─────────────────────────────
router.get("/campaigns/:id/no-reply", async (req, res) => {
  const userId   = req.session.userId!;
  const campId   = parseInt(req.params.id);
  const { days = "5" } = req.query;

  const result = await db.execute(sql`
    SELECT ml.phone, ml.sent_at, ml.id, ml.follow_up_no
    FROM message_logs ml
    INNER JOIN campaigns c ON c.id = ml.campaign_id
    WHERE ml.campaign_id = ${campId}
      AND c.user_id      = ${userId}
      AND ml.status      = 'sent'
      AND ml.replied_at  IS NULL
      AND ml.sent_at     < NOW() - INTERVAL '1 day' * ${parseInt(String(days))}
    ORDER BY ml.sent_at DESC
    LIMIT 500
  `);

  res.json({ contacts: result.rows, count: result.rows.length });
});

// ── Follow-up templates ───────────────────────────────────────────
router.get("/templates", async (req, res) => {
  const userId = req.session.userId!;
  const result = await db.execute(sql`
    SELECT * FROM follow_up_templates WHERE user_id = ${userId} ORDER BY created_at DESC
  `);
  res.json(result.rows);
});

router.post("/templates", async (req, res) => {
  const userId = req.session.userId!;
  const { name, message, messageType = "text", delayDays = 5, attempt = 1, campaignId } = req.body;
  if (!name?.trim() || !message?.trim()) return res.status(400).json({ error: "الاسم والرسالة مطلوبان" });
  const result = await db.execute(sql`
    INSERT INTO follow_up_templates (user_id, campaign_id, name, message, message_type, delay_days, attempt)
    VALUES (${userId}, ${campaignId ?? null}, ${name}, ${message}, ${messageType}, ${delayDays}, ${attempt})
    RETURNING *
  `);
  res.status(201).json(result.rows[0]);
});

router.patch("/templates/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id     = parseInt(req.params.id);
  const { name, message, messageType, delayDays, attempt, enabled } = req.body;
  const updates: Record<string, any> = {};
  if (name !== undefined)        updates.name         = name;
  if (message !== undefined)     updates.message      = message;
  if (messageType !== undefined) updates.message_type = messageType;
  if (delayDays !== undefined)   updates.delay_days   = delayDays;
  if (attempt !== undefined)     updates.attempt      = attempt;
  if (enabled !== undefined)     updates.enabled      = enabled;
  if (!Object.keys(updates).length) return res.status(400).json({ error: "لا توجد تحديثات" });
  const sets = Object.entries(updates).map(([k, v]) => sql`${sql.identifier(k)} = ${v}`);
  const result = await db.execute(sql`
    UPDATE follow_up_templates SET ${sql.join(sets, sql`, `)}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `);
  if (!result.rows.length) return res.status(404).json({ error: "القالب غير موجود" });
  res.json(result.rows[0]);
});

router.delete("/templates/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  await db.execute(sql`DELETE FROM follow_up_templates WHERE id = ${id} AND user_id = ${userId}`);
  res.json({ success: true });
});

// ── Send follow-up NOW to no-reply contacts ───────────────────────
router.post("/campaigns/:id/send-follow-up", async (req, res) => {
  const userId = req.session.userId!;
  const campId = parseInt(req.params.id);
  const { message, messageType = "text", mediaUrl, afterDays = 0 } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  // Verify campaign belongs to user
  const [camp] = await db.select({ id: campaignsTable.id }).from(campaignsTable).where(and(eq(campaignsTable.id, campId), eq(campaignsTable.userId as any, userId)));
  if (!camp) return res.status(404).json({ error: "الحملة غير موجودة" });

  // Get no-reply contacts
  const cutoff = afterDays > 0 ? `AND ml.sent_at < NOW() - INTERVAL '${afterDays} days'` : "";
  const result = await db.execute(sql`
    SELECT DISTINCT ml.phone
    FROM message_logs ml
    WHERE ml.campaign_id = ${campId}
      AND ml.status      = 'sent'
      AND ml.replied_at  IS NULL
  `);

  const phones: string[] = result.rows.map((r: any) => r.phone);
  if (!phones.length) return res.json({ success: true, sent: 0, message: "لا توجد أرقام لم ترد" });

  // Send in background
  let sent = 0;
  let failed = 0;
  (async () => {
    for (const phone of phones) {
      try {
        await sendMessage(userId, phone, message, messageType, mediaUrl ?? null, null, null);
        await db.execute(sql`
          UPDATE message_logs SET follow_up_no = COALESCE(follow_up_no, 0) + 1
          WHERE campaign_id = ${campId} AND phone = ${phone}
        `);
        sent++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));
    }
    logger.info({ userId, campId, sent, failed }, "Follow-up sending complete");
  })();

  res.json({ success: true, queued: phones.length, message: `تم بدء الإرسال لـ ${phones.length} رقم في الخلفية` });
});

export default router;
