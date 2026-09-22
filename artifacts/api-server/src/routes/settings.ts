import { Router } from "express";
import { db, campaignsTable, messageLogs } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { getStatus, getHealth } from "../lib/whatsapp";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ── System-wide constants exposed to the frontend ─────────────────────────────
// These reflect the actual values used by the campaign engine.
// If you change them here, update campaigns.ts / whatsapp.ts accordingly.
const SYSTEM_CONFIG = {
  sendDelayMinSec:      5,
  sendDelayMaxSec:      15,
  timeGateStartHour:    8,   // 8 AM
  timeGateEndHour:      22,  // 10 PM
  microBreakEvery:      12,  // messages
  microBreakSec:        { min: 25, max: 40 },
  longBreakEvery:       60,  // messages
  longBreakSec:         { min: 120, max: 240 },
  dailyLimitMax:        1500,
  warmupDay0Limit:      50,
  warmupDailyGrowth:    1.30,
  stuckThresholdMin:    15,
  deepIdleRebuildMin:   90,
  maxReconnectRetries:  12,
};

// GET /api/settings — returns system config + live status
router.get("/", async (req, res) => {
  const userId = req.session.userId!;

  const waStatus = getStatus(userId);

  let waHealth: Record<string, unknown> = {};
  try {
    waHealth = (await getHealth(userId)) as Record<string, unknown>;
  } catch { /* ignore */ }

  // Running campaigns count
  let runningCount = 0;
  try {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)` })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));
    runningCount = Number(row?.cnt ?? 0);
  } catch { /* ignore */ }

  res.json({
    config: SYSTEM_CONFIG,
    wa: {
      connected:    waStatus.connected,
      status:       waStatus.status,
      phone:        waStatus.phone,
      reconnectCount: (waHealth as any)?.reconnectCount ?? 0,
      uptime:         (waHealth as any)?.uptimeSeconds  ?? 0,
    },
    campaigns: {
      runningCount,
    },
  });
});

// POST /api/settings/sync-counts — sync ALL campaign counters from message_logs
// (Duplicate of /api/campaigns/sync-counts but mounted under /api/settings for
//  clarity from the settings page)
router.post("/sync-counts", async (req, res) => {
  const userId = req.session.userId!;

  const userCampaigns = await db
    .select({ id: campaignsTable.id, sentCount: campaignsTable.sentCount, failedCount: campaignsTable.failedCount })
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, userId));

  let fixed = 0;
  const details: Array<{ id: number; oldSent: number; newSent: number }> = [];

  for (const camp of userCampaigns) {
    const [real] = await db
      .select({
        realSentCount:   sql<number>`count(*) filter (where ${messageLogs.status} = 'sent')`,
        realFailedCount: sql<number>`count(*) filter (where ${messageLogs.status} = 'failed')`,
      })
      .from(messageLogs)
      .where(eq(messageLogs.campaignId, camp.id));

    const actualSent   = Number(real?.realSentCount   ?? 0);
    const actualFailed = Number(real?.realFailedCount ?? 0);

    if (actualSent !== camp.sentCount || actualFailed !== camp.failedCount) {
      await db.update(campaignsTable)
        .set({ sentCount: actualSent, failedCount: actualFailed })
        .where(eq(campaignsTable.id, camp.id));
      details.push({ id: camp.id, oldSent: camp.sentCount, newSent: actualSent });
      fixed++;
    }
  }

  logger.info({ userId, fixed, total: userCampaigns.length }, "Settings: counter sync completed");
  res.json({ fixed, total: userCampaigns.length, details });
});

export default router;
