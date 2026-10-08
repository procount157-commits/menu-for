// ── The graph, for the owner ──────────────────────────────────────
// GET   /api/graph            goals and their pace, what each employee did
//                             (today and 14 days), the ledger's integrity,
//                             the contracts, and whether the team is on.
// GET   /api/graph/receipts   the ledger itself, newest first, filterable.
// PATCH /api/graph/team       { paused } — the whole team's off switch.
// POST  /api/graph/goals      the owner sets a goal; employees cannot.
// PATCH /api/graph/goals/:id  { status: done | dropped } — the owner ends one.
//
// Staff sessions never reach here (staffGuard is default-deny), and every
// query is the signed-in account's own.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { goalsWithProgress, setGoal, closeGoal, measuresFor, MEASURES } from "../lib/graph/goals";
import { backfillReceipts, whoDidWhat } from "../lib/graph/backfill";
import { firstBroken } from "../lib/graph/receipts";
import { setTeamPaused } from "../lib/graph/switch";
import { GRAPHS, contractProblems } from "../lib/graph/contracts";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// Phase 0, once per account per process: the fortnight before the receipts,
// rebuilt from the old logs and marked inferred.
const backfilled = new Set<number>();

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  if (!backfilled.has(userId)) {
    backfilled.add(userId);
    await backfillReceipts(userId).catch((err) => logger.warn({ userId, err: String(err?.message ?? err).slice(0, 200) }, "receipts backfill failed"));
  }
  const [goals, today, fortnight, broken, paused, totals, measures] = await Promise.all([
    goalsWithProgress(userId),
    whoDidWhat(userId, 1),
    whoDidWhat(userId, 14),
    firstBroken(userId).catch(() => -1),
    db.execute<{ p: boolean }>(sql`SELECT team_paused AS p FROM business_profile WHERE user_id = ${userId}`),
    db.execute(sql`SELECT count(*)::int AS receipts, count(*) FILTER (WHERE NOT inferred)::int AS live, min(at) AS since FROM receipts WHERE user_id = ${userId}`),
    measuresFor(userId),
  ]);
  res.json({
    goals, today, fortnight,
    ledger: { firstBroken: broken, ...(totals.rows[0] as any) },
    teamPaused: !!paused.rows[0]?.p,
    graphs: GRAPHS.map((g) => ({ id: g.id, oneBreath: g.oneBreath, nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, responsibility: n.responsibility })), edges: g.edges, problems: contractProblems(g) })),
    measures,
  });
});

router.get("/receipts", async (req, res) => {
  const userId = req.session.userId!;
  const node = typeof req.query["node"] === "string" ? req.query["node"] : null;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
  const limit = Math.min(300, Number(req.query["limit"]) || 100);
  const r = await db.execute(sql`SELECT id, at, graph, node, action, status, subject, model, tokens_in, tokens_out, edge, why, inferred
    FROM receipts WHERE user_id = ${userId} ${node ? sql`AND node = ${node}` : sql``} ${status ? sql`AND status = ${status}` : sql``}
    ORDER BY id DESC LIMIT ${limit}`);
  res.json(r.rows);
});

router.patch("/team", async (req, res) => {
  const paused = !!(req.body as any)?.paused;
  await setTeamPaused(req.session.userId!, paused);
  logger.info({ userId: req.session.userId, paused }, "team switch flipped");
  res.json({ paused });
});

router.post("/goals", async (req, res) => {
  const b = req.body as any;
  const target = Math.floor(Number(b?.target)), deadline = new Date(b?.deadline);
  const startsAt = b?.startsAt ? new Date(b.startsAt) : undefined;
  if (!b?.title || !MEASURES[b?.metric] || !(target > 0) || isNaN(deadline.getTime()) || (startsAt && isNaN(startsAt.getTime()))) {
    return res.status(400).json({ error: "العنوان والمقياس والرقم والموعد مطلوبة" });
  }
  if (deadline.getTime() <= (startsAt ?? new Date()).getTime()) return res.status(400).json({ error: "الموعد يجب أن يكون بعد البداية" });
  try {
    const id = await setGoal(req.session.userId!, {
      title: String(b.title).slice(0, 200), metric: b.metric, target, deadline, startsAt,
      counters: Array.isArray(b.counters) ? b.counters.map(String) : undefined, anchor: typeof b.anchor === "string" ? b.anchor : null,
    });
    res.json({ id });
  } catch (err: any) {
    res.status(403).json({ error: String(err?.message ?? err) });
  }
});

router.patch("/goals/:id", async (req, res) => {
  const status = (req.body as any)?.status;
  if (status !== "done" && status !== "dropped") return res.status(400).json({ error: "الحالة: done أو dropped" });
  await closeGoal(req.session.userId!, Number(req.params.id), status);
  res.json({ ok: true });
});

export default router;
