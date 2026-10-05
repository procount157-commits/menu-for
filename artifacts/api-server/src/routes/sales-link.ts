// ── /s/<token>/<key> — a link the seller sent a shop ──────────────
// Counted on the shop (not for link-preview robots), then redirected to the
// demo menu, the sign-up page or the video. An unknown token still lands
// somewhere useful.

import { Router } from "express";
import { recordClick } from "../lib/sales/service";
import { publicUrl } from "../lib/menu/urls";

const router = Router();

router.get("/s/:token/:key", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = String(req.params.token).replace(/[^a-z0-9]/gi, "").slice(0, 12);
  const key = String(req.params.key).replace(/[^a-z]/gi, "").slice(0, 20);
  const to = await recordClick(token, key, String(req.headers["user-agent"] ?? "")).catch(() => null);
  res.redirect(302, to || publicUrl("/"));
});

export default router;
