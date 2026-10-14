// ── /api/team — غرفة الفريق ومديرة الواتساب ────────────────────────
import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { teamRoom, employeeDetail, ownerSays } from "../lib/team/room";
import { runWaManagerCycle, waManagerState } from "../lib/wa-manager";

const router = Router();
router.use(requireAuth);
router.get("/room", async (req, res) => res.json(await teamRoom(req.session.userId!, { days: Math.min(30, Math.max(1, Number(req.query["days"]) || 7)) })));
router.get("/room/:role", async (req, res) => res.json(await employeeDetail(req.session.userId!, String(req.params["role"]))));
router.post("/room/:role/say", async (req, res) => {
  const body = String(req.body?.body ?? "").trim();
  if (body.length < 3) return res.status(400).json({ error: "اكتب التوجيه" });
  await ownerSays(req.session.userId!, String(req.params["role"]), body);
  res.json({ ok: true });
});
router.get("/wa-manager", async (req, res) => res.json(await waManagerState(req.session.userId!)));
router.post("/wa-manager/run", async (req, res) => {
  void runWaManagerCycle(req.session.userId!, { brief: true, notifyOwner: req.body?.notify !== false }).catch(() => {});
  res.json({ started: true, note: "بدأت دورة شمّة: القوائم ← النتائج ← تقييم كل موظف ← المهام ← التقرير." });
});
export default router;
