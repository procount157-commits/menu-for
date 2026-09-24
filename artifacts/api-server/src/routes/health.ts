import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { waManager } from "../lib/whatsapp";
import { activeProvider } from "../lib/llm";

const router: IRouter = Router();
const startedAt = Date.now();

// Liveness. Deliberately answers without touching the database, so a database
// blip does not make the orchestrator kill an otherwise healthy process.
router.get("/healthz", (_req, res) => {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

/**
 * Readiness, in detail — what the heartbeat reads.
 *
 * Unauthenticated on purpose so a monitor can reach it, and for that reason it
 * reports counts and states only: nothing here identifies a customer or leaks
 * a number.
 *
 * `status` is "ok" when everything essential works, "degraded" when the app is
 * serving but something needs attention (no WhatsApp linked, no model), and
 * "error" only when the database is unreachable — the one failure that makes
 * the app useless rather than merely diminished.
 */
router.get("/health/deep", async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  let dbOk = false;
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    checks.database = { ok: true, detail: `${Date.now() - t0}ms` };
  } catch (err: any) {
    checks.database = { ok: false, detail: String(err?.message ?? err).slice(0, 120) };
  }

  // Sessions restored into memory, and how many are actually online.
  let connected = 0, total = 0;
  try {
    const states = waManager.allStates();
    total = states.length;
    connected = states.filter((s) => s.connected).length;
    checks.whatsapp = {
      ok: total === 0 || connected > 0,
      detail: total === 0 ? "لا توجد جلسات" : `${connected}/${total} متصل`,
    };
  } catch {
    checks.whatsapp = { ok: false, detail: "تعذّر قراءة الحالة" };
  }

  const provider = activeProvider();
  checks.llm = { ok: provider !== "none", detail: provider };

  const mem = process.memoryUsage();
  checks.memory = {
    ok: mem.rss < 1_400 * 1024 * 1024,
    detail: `${Math.round(mem.rss / 1024 / 1024)}MB`,
  };

  const essentialsOk = dbOk;
  const allOk = Object.values(checks).every((c) => c.ok);

  res.status(essentialsOk ? 200 : 503).json({
    status: !essentialsOk ? "error" : allOk ? "ok" : "degraded",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    waConnected: connected,
    waSessions: total,
    checks,
    at: new Date().toISOString(),
  });
});

export default router;
