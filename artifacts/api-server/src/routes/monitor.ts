import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { runMonitorFor, latestReports, MONITOR_INTERVAL_MS } from "../lib/monitor-agent";

const router = Router();
router.use(requireAuth);

router.get("/reports", async (req, res) => {
  const rows = await latestReports(req.session.userId!);
  res.json({ intervalMinutes: MONITOR_INTERVAL_MS / 60_000, reports: rows });
});

/** Run the checks now instead of waiting for the next sweep. */
router.post("/run", async (req, res) => {
  res.json(await runMonitorFor(req.session.userId!));
});

export default router;
