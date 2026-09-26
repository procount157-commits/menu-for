// ── Meetings ──────────────────────────────────────────────────────

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { runMeeting, meetingWithTurns, recentMeetings } from "../lib/meeting";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => res.json(await recentMeetings(req.session.userId!)));

router.get("/:id", async (req, res) => {
  const m = await meetingWithTurns(req.session.userId!, parseInt(req.params.id!));
  if (!m) return res.status(404).json({ error: "الاجتماع غير موجود" });
  res.json(m);
});

/**
 * Call one now.
 *
 * Slow on purpose — nine model calls in sequence, each reading what came
 * before it, which is what makes it a discussion rather than six reports
 * generated in parallel.
 */
router.post("/run", async (req, res) => {
  const kind = ["daily", "pipeline", "postmortem"].includes(req.body?.kind) ? req.body.kind : "daily";
  res.json(await runMeeting(req.session.userId!, kind));
});

export default router;
