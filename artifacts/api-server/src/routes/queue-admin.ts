// ── /api/queue (the staff screen) and /api/queues (settings) ──────

import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, queuesTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, ALL, MANAGERS, type Tenant } from "../lib/tenancy/context";
import { queueCtx, staffView, callNext, callTicket, transition, walkIn, setQueueState, adjustEta, QueueError, type QueueCtx } from "../lib/queue/engine";
import { stream } from "../lib/realtime";
import { normalisePhone } from "../lib/customers";
import { assertFeature } from "../lib/plans";
import { vocab } from "@workspace/menu-shared";

const router = Router();

/** The queue, if it belongs to a branch this person may act on. */
async function own(t: Tenant, id: unknown): Promise<QueueCtx | null> {
  const ctx = await queueCtx(Number(id));
  if (!ctx || ctx.org.id !== t.org.id || !t.branchIds.includes(ctx.branch.id)) return null;
  return ctx;
}

const staffId = (t: Tenant) => t.staffId;

function fail(res: Response, err: unknown) {
  if (err instanceof QueueError) return res.status(err.status).json({ error: err.message, ...err.extra });
  throw err;
}

// ── The screen ────────────────────────────────────────────────────

router.get("/queue", requireAuth, withTenant(ALL, async (_req, res, t) => {
  const qs = await db.select().from(queuesTable).where(and(eq(queuesTable.branchId, t.branch.id), eq(queuesTable.isActive, true))).orderBy(asc(queuesTable.sort), asc(queuesTable.id));
  res.json(qs);
}));

router.get("/queue/:id", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  res.json(await staffView(ctx));
}));

router.get("/queue/:id/stream", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const id = ctx.queue.id;
  stream(req, res, [`queue:${id}`], async () => {
    const c = await queueCtx(id);
    return c ? staffView(c) : null;
  });
}));

router.post("/queue/:id/next", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const called = await callNext(ctx, staffId(t));
  res.json({ called, view: await staffView((await queueCtx(ctx.queue.id))!) });
}));

router.post("/queue/:id/call/:ticketId", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const called = await callTicket(ctx, Number(req.params.ticketId), staffId(t));
  if (!called) return res.status(409).json({ error: "هذه التذكرة لم تعد في الانتظار" });
  res.json({ called, view: await staffView((await queueCtx(ctx.queue.id))!) });
}));

const ACTIONS = { recall: "recall", arrived: "arrived", done: "done", "no-show": "no_show", requeue: "requeue", remove: "remove" } as const;

router.post("/queue/:id/tickets/:ticketId/:action", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const action = ACTIONS[String(req.params.action) as keyof typeof ACTIONS];
  if (!action) return res.status(400).json({ error: "إجراء غير معروف" });
  try {
    const ticket = await transition(ctx, Number(req.params.ticketId), action, staffId(t), { finish: !!req.body?.finish });
    res.json({ ticket, view: await staffView((await queueCtx(ctx.queue.id))!) });
  } catch (err) { fail(res, err); }
}));

router.post("/queue/:id/walk-in", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const b = req.body ?? {};
  const phone = normalisePhone(b.phone, ctx.org.currency);
  if (b.phone && !phone) return res.status(400).json({ error: "رقم الواتساب غير صحيح" });
  try {
    const ticket = await walkIn(ctx, { name: b.name, partySize: b.partySize, phone, note: b.note }, staffId(t));
    res.status(201).json({ ticket, view: await staffView((await queueCtx(ctx.queue.id))!) });
  } catch (err) { fail(res, err); }
}));

router.post("/queue/:id/state", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const change = String(req.body?.change);
  if (!["open", "close", "pause", "resume"].includes(change)) return res.status(400).json({ error: "تغيير غير معروف" });
  await setQueueState(ctx, change as "open", staffId(t));
  res.json(await staffView((await queueCtx(ctx.queue.id))!));
}));

router.post("/queue/:id/eta", requireAuth, withTenant(ALL, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  await adjustEta(ctx, req.body?.reset ? null : Number(req.body?.delta) || 0, staffId(t));
  res.json(await staffView((await queueCtx(ctx.queue.id))!));
}));

// ── Settings ──────────────────────────────────────────────────────

function settingsPatch(b: any) {
  const p: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) p.name = b.name.trim().slice(0, 80);
  if ("nameEn" in b) p.nameEn = String(b.nameEn ?? "").trim().slice(0, 80) || null;
  if (typeof b.prefix === "string" && /^[A-Za-z]{1,3}$/.test(b.prefix)) p.prefix = b.prefix.toUpperCase();
  const int = (k: string, lo: number, hi: number) => { if (k in b && Number.isFinite(Number(b[k]))) p[k] = Math.max(lo, Math.min(hi, Math.round(Number(b[k])))); };
  int("avgServiceMin", 1, 240); int("maxWaiting", 1, 1000); int("notifyAhead", 0, 20); int("noShowMin", 1, 60); int("sort", 0, 100);
  for (const k of ["autoNoShow", "askPartySize", "askService", "isActive", "isOpen"]) if (typeof b[k] === "boolean") p[k] = b[k];
  if (b.remoteJoin === "anyone" || b.remoteJoin === "qr_only") p.remoteJoin = b.remoteJoin;
  if ("photoUrl" in b) p.photoUrl = typeof b.photoUrl === "string" && /^(https?:\/\/|\/)/.test(b.photoUrl) ? b.photoUrl.slice(0, 500) : null;
  return p;
}

router.get("/queues", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  res.json(await db.select().from(queuesTable).where(eq(queuesTable.branchId, t.branch.id)).orderBy(asc(queuesTable.sort), asc(queuesTable.id)));
}));

// A chair is one barber's own line, named after him: the customer picks whose
// line to join. Only a barbershop is offered chairs — every other kind of shop
// keeps the queue it has, and never sees the option.
router.post("/queues", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  await assertFeature(t.org.ownerUserId, "queue");
  const p = settingsPatch(req.body ?? {});
  const chair = req.body?.kind === "chair";
  if (chair && t.org.vertical !== "barber") return res.status(403).json({ error: "الكراسي لمحلات الحلاقة الرجالي فقط" });
  if (!p.name) return res.status(400).json({ error: chair ? "اكتب اسم الحلاق" : "اسم الصف مطلوب" });
  if (!p.prefix) {
    // Each line its own letter, so «B-4» says whose chair at a glance.
    const taken = new Set((await db.select({ prefix: queuesTable.prefix }).from(queuesTable).where(eq(queuesTable.branchId, t.branch.id))).map((x) => x.prefix));
    p.prefix = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("").find((l) => !taken.has(l)) ?? "Z";
  }
  if (chair) Object.assign(p, { askPartySize: false, askService: true, avgServiceMin: p.avgServiceMin ?? vocab(t.org.vertical).avgServiceMin });
  const [q] = await db.insert(queuesTable).values({ orgId: t.org.id, branchId: t.branch.id, name: p.name as string, ...p, kind: chair ? "chair" : "line" }).returning();
  const { publish } = await import("../lib/realtime");
  publish(`branch:${t.branch.id}`);
  res.status(201).json(q);
}));

router.patch("/queues/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const ctx = await own(t, req.params.id);
  if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
  const [q] = await db.update(queuesTable).set(settingsPatch(req.body ?? {})).where(eq(queuesTable.id, ctx.queue.id)).returning();
  const { publish } = await import("../lib/realtime");
  publish(`queue:${q!.id}`); publish(`branch:${ctx.branch.id}`);
  res.json(q);
}));

export default router;
