// ── Lead cards ────────────────────────────────────────────────────
// What the team knows about each lead, where the sale is, and who holds the
// thread — a person or the bot.

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { getCard, funnel, takeover, release, STAGES, TAKEOVER_MINUTES } from "../lib/lead-card";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  res.json({ ...(await funnel(req.session.userId!)), stages: STAGES });
});

router.get("/:phone", async (req, res) => {
  const card = await getCard(req.session.userId!, req.params.phone);
  res.json({ card, stages: STAGES, humanHeld: !!card?.humanUntil && new Date(card.humanUntil).getTime() > Date.now() });
});

/** The owner takes the thread; the bot and the follow-ups go quiet. */
router.post("/:phone/takeover", async (req, res) => {
  const minutes = Number(req.body?.minutes) > 0 ? Number(req.body.minutes) : TAKEOVER_MINUTES;
  const until = await takeover(req.session.userId!, req.params.phone, "owner", minutes);
  res.json({ humanUntil: until });
});

/** ...and hands it back. */
router.post("/:phone/release", async (req, res) => {
  await release(req.session.userId!, req.params.phone);
  res.json({ ok: true });
});

export default router;
