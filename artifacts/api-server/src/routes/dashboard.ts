import { Router } from "express";
import { db, campaignsTable, contactGroupsTable, contactsTable } from "@workspace/db";
import { eq, desc, count, sql, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/stats", async (req, res) => {
  const userId = req.session.userId!;

  const [totals] = await db
    .select({
      totalCampaigns: count(campaignsTable.id),
      totalSent: sql<number>`coalesce(sum(${campaignsTable.sentCount}), 0)`,
      totalFailed: sql<number>`coalesce(sum(${campaignsTable.failedCount}), 0)`,
    })
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, userId));

  const [activeCampaignsCount] = await db
    .select({ count: count(campaignsTable.id) })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));

  const [totalContactsCount] = await db
    .select({ count: count(contactsTable.id) })
    .from(contactsTable)
    .innerJoin(contactGroupsTable, eq(contactsTable.groupId, contactGroupsTable.id))
    .where(eq(contactGroupsTable.userId, userId));

  const recentCampaigns = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      status: campaignsTable.status,
      contactGroupId: campaignsTable.contactGroupId,
      contactGroupName: contactGroupsTable.name,
      message: campaignsTable.message,
      messageType: campaignsTable.messageType,
      mediaUrl: campaignsTable.mediaUrl,
      buttons: campaignsTable.buttons,
      carousel: campaignsTable.carousel,
      pacingMode: campaignsTable.pacingMode,
      delayMin: campaignsTable.delayMin,
      delayMax: campaignsTable.delayMax,
      scheduledAt: campaignsTable.scheduledAt,
      sentCount: campaignsTable.sentCount,
      failedCount: campaignsTable.failedCount,
      totalCount: campaignsTable.totalCount,
      createdAt: campaignsTable.createdAt,
    })
    .from(campaignsTable)
    .leftJoin(contactGroupsTable, eq(campaignsTable.contactGroupId, contactGroupsTable.id))
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt))
    .limit(5);

  res.json({
    totalCampaigns: totals.totalCampaigns,
    activeCampaigns: activeCampaignsCount.count,
    totalContacts: totalContactsCount.count,
    totalSent: Number(totals.totalSent),
    totalFailed: Number(totals.totalFailed),
    recentCampaigns: recentCampaigns.map((c) => ({ ...c, contactGroupName: c.contactGroupName || null })),
  });
});

export default router;
