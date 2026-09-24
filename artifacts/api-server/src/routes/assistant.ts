import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { listThreads, getThreadMessages, chat, deleteThread, buildContext } from "../lib/assistant";
import { providerStatus } from "../lib/llm";

const router = Router();
router.use(requireAuth);

router.get("/threads", async (req, res) => res.json(await listThreads(req.session.userId!)));

router.get("/threads/:id", async (req, res) => {
  res.json(await getThreadMessages(req.session.userId!, parseInt(req.params.id!)));
});

router.delete("/threads/:id", async (req, res) => {
  await deleteThread(req.session.userId!, parseInt(req.params.id!));
  res.json({ success: true });
});

router.post("/chat", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "اكتب رسالة" });

  const threadId = req.body?.threadId ? parseInt(String(req.body.threadId)) : null;
  const out = await chat(req.session.userId!, Number.isFinite(threadId!) ? threadId : null, message.slice(0, 4_000));
  res.json(out);
});

/** What the assistant currently knows — shown so its answers can be checked. */
router.get("/context", async (req, res) => {
  res.json({ context: await buildContext(req.session.userId!), ...providerStatus() });
});

export default router;
