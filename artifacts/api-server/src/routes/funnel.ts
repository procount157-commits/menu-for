import { Router } from "express";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db, campaignsTable, messageLogs,
  trackingLinksTable, trackingEventsTable,
  incomingMessagesTable, contactGroupsTable, contactsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

// ── مساعد: استخراج الأرقام التي نقرت بناءً على الحملة ──────────────
// أولوية: روابط مرتبطة بالحملة تحديداً → احتياط: كل نقرة بعد بدء الحملة
async function getClickedPhones(
  userId: number,
  campaignId: number,
  sentPhones: string[],
  earliestSent: Date,
): Promise<{ phones: string[]; mode: "campaign" | "time" }> {
  if (sentPhones.length === 0) return { phones: [], mode: "campaign" };

  // هل هناك روابط مرتبطة بهذه الحملة تحديداً؟
  const campaignLinks = await db
    .select({ id: trackingLinksTable.id })
    .from(trackingLinksTable)
    .where(and(
      eq(trackingLinksTable.userId, userId),
      eq(trackingLinksTable.campaignId, campaignId),
    ));

  if (campaignLinks.length > 0) {
    // وضع دقيق: نقرات على روابط هذه الحملة فقط
    const linkIds = campaignLinks.map(l => l.id);
    const events = await db
      .select({ phone: trackingEventsTable.phone })
      .from(trackingEventsTable)
      .where(and(
        eq(trackingEventsTable.userId, userId),
        inArray(trackingEventsTable.linkId, linkIds),
      ));
    const clickedSet = new Set(events.map(e => e.phone).filter(Boolean) as string[]);
    return {
      phones: sentPhones.filter(p => clickedSet.has(p)),
      mode: "campaign",
    };
  }

  // احتياط: أي نقرة من هذا المستخدم بعد بداية الحملة
  const events = await db
    .select({ phone: trackingEventsTable.phone })
    .from(trackingEventsTable)
    .where(and(
      eq(trackingEventsTable.userId, userId),
      gte(trackingEventsTable.clickedAt, earliestSent),
    ));
  const clickedSet = new Set(events.map(e => e.phone).filter(Boolean) as string[]);
  return {
    phones: sentPhones.filter(p => clickedSet.has(p)),
    mode: "time",
  };
}

// ── GET /api/funnel/campaign/:id ─────────────────────────────────
router.get("/campaign/:id", async (req, res): Promise<void> => {
  const userId     = req.session.userId!;
  const campaignId = parseInt(req.params.id);

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));

  if (!campaign) { res.status(404).json({ error: "الحملة غير موجودة" }); return; }

  // 1. كل الأرقام المُرسَلة في هذه الحملة
  const sentLogs = await db
    .select({ phone: messageLogs.phone, sentAt: messageLogs.sentAt })
    .from(messageLogs)
    .where(and(eq(messageLogs.campaignId, campaignId), eq(messageLogs.status, "sent")));

  const sentPhones   = sentLogs.map(r => r.phone);
  const earliestSent = sentLogs.reduce<Date | null>((acc, r) => {
    const d = r.sentAt ? new Date(r.sentAt) : null;
    return !acc ? d : (d && d < acc ? d : acc);
  }, null) ?? new Date(campaign.createdAt);

  // 2. الأرقام التي نقرت (دقيق بالحملة أو احتياطي بالوقت)
  const { phones: clickedPhones, mode: clickMode } =
    await getClickedPhones(userId, campaignId, sentPhones, earliestSent);

  // 3. الأرقام التي ردّت (رسائل واردة بعد بدء الحملة)
  let repliedPhones: string[] = [];
  if (sentPhones.length > 0) {
    const replies = await db
      .select({ phone: incomingMessagesTable.phone })
      .from(incomingMessagesTable)
      .where(and(
        eq(incomingMessagesTable.userId, userId),
        gte(incomingMessagesTable.receivedAt, earliestSent),
      ));
    const repliedSet = new Set(replies.map(r => r.phone));
    repliedPhones = sentPhones.filter(p => repliedSet.has(p));
  }

  // 4. الشرائح المشتقة
  const clickedSet = new Set(clickedPhones);
  const repliedSet = new Set(repliedPhones);
  const noReply    = sentPhones.filter(p => !repliedSet.has(p));
  const notClicked = sentPhones.filter(p => !clickedSet.has(p));
  const hotLeads   = sentPhones.filter(p => clickedSet.has(p) && !repliedSet.has(p));

  // حساب إحصائيات الروابط المرتبطة
  const campaignLinksStats = await db
    .select({
      id: trackingLinksTable.id,
      title: trackingLinksTable.title,
      code: trackingLinksTable.code,
      clicks: trackingLinksTable.clicks,
    })
    .from(trackingLinksTable)
    .where(and(
      eq(trackingLinksTable.userId, userId),
      eq(trackingLinksTable.campaignId, campaignId),
    ));

  res.json({
    campaign: {
      id: campaign.id, name: campaign.name, status: campaign.status, createdAt: campaign.createdAt,
      sentCount: campaign.sentCount, failedCount: campaign.failedCount, totalCount: campaign.totalCount,
    },
    tracking: {
      mode: clickMode, // "campaign" = دقيق | "time" = تقريبي
      campaignLinks: campaignLinksStats,
    },
    stages: {
      sent:       { count: sentPhones.length,    phones: sentPhones },
      clicked:    { count: clickedPhones.length,  phones: clickedPhones },
      replied:    { count: repliedPhones.length,  phones: repliedPhones },
      noReply:    { count: noReply.length,         phones: noReply },
      notClicked: { count: notClicked.length,      phones: notClicked },
      hotLeads:   { count: hotLeads.length,        phones: hotLeads },
    },
  });
});

// ── POST /api/funnel/campaign/:id/extract ─────────────────────────
router.post("/campaign/:id/extract", async (req, res): Promise<void> => {
  const userId     = req.session.userId!;
  const campaignId = parseInt(req.params.id);
  const { stage, groupName } = req.body;

  if (!groupName?.trim()) { res.status(400).json({ error: "اسم القائمة مطلوب" }); return; }

  const validStages = ["sent", "clicked", "replied", "noReply", "notClicked", "hotLeads"];
  if (!validStages.includes(stage)) { res.status(400).json({ error: "مرحلة غير صحيحة" }); return; }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "الحملة غير موجودة" }); return; }

  const sentLogs = await db
    .select({ phone: messageLogs.phone, sentAt: messageLogs.sentAt })
    .from(messageLogs)
    .where(and(eq(messageLogs.campaignId, campaignId), eq(messageLogs.status, "sent")));

  const sentPhones   = sentLogs.map(r => r.phone);
  const earliestSent = sentLogs.reduce<Date | null>((acc, r) => {
    const d = r.sentAt ? new Date(r.sentAt) : null;
    return !acc ? d : (d && d < acc ? d : acc);
  }, null) ?? new Date(campaign.createdAt);

  const { phones: clickedPhones } = await getClickedPhones(userId, campaignId, sentPhones, earliestSent);

  const reps = await db
    .select({ phone: incomingMessagesTable.phone })
    .from(incomingMessagesTable)
    .where(and(eq(incomingMessagesTable.userId, userId), gte(incomingMessagesTable.receivedAt, earliestSent)));

  const clickedSet = new Set(clickedPhones);
  const repliedSet = new Set(reps.map(r => r.phone));

  let phones: string[] = [];
  switch (stage) {
    case "sent":       phones = sentPhones; break;
    case "clicked":    phones = sentPhones.filter(p => clickedSet.has(p)); break;
    case "replied":    phones = sentPhones.filter(p => repliedSet.has(p)); break;
    case "noReply":    phones = sentPhones.filter(p => !repliedSet.has(p)); break;
    case "notClicked": phones = sentPhones.filter(p => !clickedSet.has(p)); break;
    case "hotLeads":   phones = sentPhones.filter(p => clickedSet.has(p) && !repliedSet.has(p)); break;
  }

  if (phones.length === 0) { res.status(400).json({ error: "لا توجد أرقام في هذه المرحلة" }); return; }

  const [group] = await db
    .insert(contactGroupsTable)
    .values({ userId, name: groupName.trim() })
    .returning();

  const rows = phones.map(phone => ({ groupId: group.id, phone }));
  await db.insert(contactsTable).values(rows).onConflictDoNothing();

  res.status(201).json({ groupId: group.id, count: phones.length, groupName: group.name });
});

export default router;
