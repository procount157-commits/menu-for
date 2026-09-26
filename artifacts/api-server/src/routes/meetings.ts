// ── Meetings ──────────────────────────────────────────────────────

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { db, meetingProposalsTable } from "@workspace/db";
import { runMeeting, meetingWithTurns, recentMeetings } from "../lib/meeting";
import { remember } from "../lib/agent-memory";
import { say } from "../lib/agent-comms";

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

/** Decisions waiting on the owner because they would change how sending runs. */
router.get("/proposals/pending", async (req, res) => {
  res.json(await db.select().from(meetingProposalsTable)
    .where(and(eq(meetingProposalsTable.userId, req.session.userId!), eq(meetingProposalsTable.status, "pending")))
    .orderBy(desc(meetingProposalsTable.createdAt)));
});

/**
 * Approve or reject one.
 *
 * Approving is what finally writes it into the employee's memory — until then
 * the rule exists only as something the team argued for.
 */
router.post("/proposals/:id/:verdict", async (req, res) => {
  const userId = req.session.userId!;
  const verdict = req.params.verdict === "approve" ? "approved" : "rejected";

  const [p] = await db.select().from(meetingProposalsTable)
    .where(and(eq(meetingProposalsTable.id, parseInt(req.params.id!)), eq(meetingProposalsTable.userId, userId)))
    .limit(1);
  if (!p) return res.status(404).json({ error: "الاقتراح غير موجود" });
  if (p.status !== "pending") return res.status(409).json({ error: "سبق البتّ فيه" });

  await db.update(meetingProposalsTable).set({ status: verdict, decidedAt: new Date() })
    .where(eq(meetingProposalsTable.id, p.id));

  if (verdict === "approved") {
    await remember(userId, p.role, "instruction", p.rule);
    await say({ userId, fromRole: "owner", toRole: p.role, kind: "directive",
      body: `وافقت على قرار الاجتماع: ${p.rule}` }).catch(() => {});
  } else {
    await say({ userId, fromRole: "owner", toRole: "chief", kind: "directive",
      body: `رفضت اقتراح إيقاف: ${p.rule}` }).catch(() => {});
  }
  res.json({ ok: true, status: verdict });
});

export default router;
