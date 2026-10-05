// ── /api/sales — the platform's own seller, for the admin ─────────
// Train it (persona, rules, links, offer), give it a list of shops, set its
// day (40 new a day, follow-ups on days 2…30, hours), watch every
// conversation with its memory, teach it from a real exchange, and try it in
// the arena before anything is sent.

import { Router } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, salesProspectsTable, salesTouchesTable, waThreadMessagesTable, contactsTable, contactGroupsTable, unsubscribedPhonesTable, usersTable, type SalesProspect, type SalesStage } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { normalisePhone } from "../lib/customers";
import { memoryFor, forget } from "../lib/agent-memory";
import { getStatus } from "../lib/whatsapp";
import { getDailyRemaining, getEffectiveDailyLimit, numberAgeDays } from "../lib/daily-limit";
import { guessVertical, parseProspects, sellerPrompt, prospectCard, taskFor, STAGE_AR, VERTICAL_AR, type SalesVertical } from "../lib/sales/brief";
import { composeFor, deliver, linkFor, linkTargets, newToken, productFacts, saveSalesSettings, salesSettings, sendFollowUp, sendOpener, setStage, teach, demoKey } from "../lib/sales/service";
import { salesTick, closedReason, recentOpeners, WARMUP_DAYS } from "../lib/sales/engine";
import { salesStats } from "../lib/sales/stats";
import { memoryPreamble } from "../lib/agent-memory";

const router = Router();
router.use(requireAdmin);

const STAGES: SalesStage[] = ["new", "contacted", "replied", "interested", "trial", "won", "lost", "stopped", "paused"];
const wa = async (req: any) => (await salesSettings()).waUserId ?? Number(req.session.userId);

// ── Settings, and what the seller is told ─────────────────────────

router.get("/settings", async (req, res) => {
  const s = await salesSettings();
  const waUserId = s.waUserId ?? Number(req.session.userId);
  const facts = await productFacts();
  const targets = linkTargets(s);
  const sample = { id: 0, token: "XXXXXXXX", name: null, business: "مطعم مثال", vertical: "restaurant", city: "دبي", stage: "replied", step: 1, replies: 1, clicks: 0, facts: [], summary: null, linksSent: [] } as any;
  const links = Object.fromEntries(Object.keys(targets).map((k) => [k, linkFor(s, sample, k as any)]).filter(([, u]) => u));
  const memory = await memoryPreamble(waUserId, "sales").catch(() => "");
  const [accounts, status, age, limit, room] = await Promise.all([
    db.select({ id: usersTable.id, name: usersTable.displayName, phone: usersTable.phone }).from(usersTable).where(eq(usersTable.isAdmin, true)).orderBy(asc(usersTable.id)),
    Promise.resolve(getStatus(waUserId) as any),
    numberAgeDays(waUserId).catch(() => 0),
    getEffectiveDailyLimit(waUserId).catch(() => 0),
    getDailyRemaining(waUserId).catch(() => 0),
  ]);
  res.json({
    settings: s, targets, productFacts: facts.text,
    prompt: sellerPrompt({ s, product: facts.text, links, memory, card: prospectCard(sample), mode: "reply", task: taskFor("reply", s) }),
    account: { waUserId, connected: !!status?.connected, phone: status?.phone ?? null, ageDays: Math.floor(age), warm: age >= WARMUP_DAYS, dailyLimit: limit, dailyRemaining: room },
    accounts, closed: closedReason(s, new Date()),
  });
});

router.put("/settings", async (req, res) => {
  res.json({ settings: await saveSalesSettings(req.body ?? {}) });
});

// ── The list ──────────────────────────────────────────────────────

router.get("/prospects", async (req, res) => {
  const waUserId = await wa(req);
  const stage = String(req.query.stage ?? "");
  const q = String(req.query.q ?? "").trim();
  const page = Math.max(0, Number(req.query.page ?? 0) || 0);
  const where = and(
    eq(salesProspectsTable.waUserId, waUserId),
    STAGES.includes(stage as SalesStage) ? eq(salesProspectsTable.stage, stage as SalesStage) : undefined,
    q ? or(ilike(salesProspectsTable.phone, `%${q}%`), ilike(salesProspectsTable.name, `%${q}%`), ilike(salesProspectsTable.business, `%${q}%`), ilike(salesProspectsTable.city, `%${q}%`)) : undefined,
  );
  const [rows, counts] = await Promise.all([
    db.select().from(salesProspectsTable).where(where)
      .orderBy(sql`CASE ${salesProspectsTable.stage} WHEN 'interested' THEN 0 WHEN 'replied' THEN 1 WHEN 'trial' THEN 2 ELSE 3 END`, desc(salesProspectsTable.updatedAt))
      .limit(50).offset(page * 50),
    db.select({ stage: salesProspectsTable.stage, n: sql<number>`count(*)::int` }).from(salesProspectsTable).where(eq(salesProspectsTable.waUserId, waUserId)).groupBy(salesProspectsTable.stage),
  ]);
  res.json({ rows, counts: Object.fromEntries(counts.map((c) => [c.stage, c.n])), stageLabels: STAGE_AR });
});

/** Add shops: pasted lines, or a contact list already in the system. Up to 5000 at a time. */
router.post("/prospects/import", async (req, res) => {
  const waUserId = await wa(req);
  const b = req.body ?? {};
  const source = String(b.source ?? "list").slice(0, 40) || "list";
  const forced = (b.vertical && b.vertical in VERTICAL_AR) ? b.vertical as SalesVertical : null;
  let rows: Array<{ phone: string; name: string | null; business: string | null; vertical: string | null; city: string | null }> = [];
  let bad = 0;
  if (b.groupId) {
    const [g] = await db.select().from(contactGroupsTable).where(eq(contactGroupsTable.id, Number(b.groupId))).limit(1);
    if (!g) return res.status(404).json({ error: "القائمة غير موجودة" });
    const cs = await db.select({ phone: contactsTable.phone, name: contactsTable.name }).from(contactsTable).where(and(eq(contactsTable.groupId, g.id), eq(contactsTable.status, "active"))).limit(5000);
    for (const c of cs) {
      const phone = normalisePhone(c.phone, "AED");
      if (!phone) { bad++; continue; }
      rows.push({ phone, name: c.name ?? null, business: c.name ?? null, vertical: guessVertical(c.name, g.name), city: null });
    }
  } else {
    const parsed = parseProspects(String(b.text ?? "").slice(0, 2_000_000), (r) => normalisePhone(r, String(b.currency ?? "AED")));
    rows = parsed.rows; bad = parsed.bad;
  }
  rows = rows.slice(0, 5000);
  if (!rows.length) return res.status(400).json({ error: "لم أجد أرقاماً صالحة", bad });
  const unsub = new Set((await db.select({ phone: unsubscribedPhonesTable.phone }).from(unsubscribedPhonesTable)
    .where(and(eq(unsubscribedPhonesTable.userId, waUserId), inArray(unsubscribedPhonesTable.phone, rows.map((r) => r.phone))))).map((r) => r.phone));
  const fresh = rows.filter((r) => !unsub.has(r.phone));
  let added = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500).map((r) => ({
      waUserId, phone: r.phone, name: r.name, business: r.business, vertical: forced ?? r.vertical, city: r.city, source, token: newToken(), priority: Number(b.priority) || 0,
    }));
    const ins = await db.insert(salesProspectsTable).values(chunk).onConflictDoNothing().returning({ id: salesProspectsTable.id });
    added += ins.length;
  }
  res.json({ added, duplicates: fresh.length - added, unsubscribed: rows.length - fresh.length, bad });
});

async function own(req: any, res: any): Promise<SalesProspect | null> {
  const [p] = await db.select().from(salesProspectsTable).where(and(eq(salesProspectsTable.id, Number(req.params.id)), eq(salesProspectsTable.waUserId, await wa(req)))).limit(1);
  if (!p) { res.status(404).json({ error: "غير موجود" }); return null; }
  return p;
}

/** One shop: its card, its timeline (our sends, its replies, clicks, lessons) and the WhatsApp thread. */
router.get("/prospects/:id", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  const [touches, thread] = await Promise.all([
    db.select().from(salesTouchesTable).where(eq(salesTouchesTable.prospectId, p.id)).orderBy(asc(salesTouchesTable.at)).limit(300),
    db.select({ text: waThreadMessagesTable.text, fromMe: waThreadMessagesTable.fromMe, at: waThreadMessagesTable.createdAt }).from(waThreadMessagesTable)
      .where(and(eq(waThreadMessagesTable.userId, p.waUserId), eq(waThreadMessagesTable.phone, p.phone))).orderBy(desc(waThreadMessagesTable.createdAt)).limit(60),
  ]);
  res.json({ prospect: p, touches, thread: thread.reverse() });
});

router.patch("/prospects/:id", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  const b = req.body ?? {};
  const patch: Partial<SalesProspect> = { updatedAt: new Date() };
  for (const [k, max] of [["name", 120], ["business", 160], ["city", 80], ["note", 2000]] as const) if (k in b) (patch as any)[k] = String(b[k] ?? "").trim().slice(0, max) || null;
  if ("vertical" in b) patch.vertical = b.vertical in VERTICAL_AR ? b.vertical : null;
  if ("priority" in b) patch.priority = Math.max(-100, Math.min(100, Math.round(Number(b.priority) || 0)));
  await db.update(salesProspectsTable).set(patch).where(eq(salesProspectsTable.id, p.id));
  if (b.stage && STAGES.includes(b.stage) && b.stage !== p.stage) {
    if (b.stage === "new") await db.update(salesProspectsTable).set({ stage: "new", step: 0, nextAt: null, firstSentAt: null, stopReason: null }).where(eq(salesProspectsTable.id, p.id));
    else await setStage(p, b.stage, String(b.reason ?? "تغيير يدوي").slice(0, 80), "human");
    if (b.stage === "contacted" || b.stage === "replied" || b.stage === "interested") {
      await db.update(salesProspectsTable).set({ nextAt: new Date(Date.now() + 86_400_000) }).where(eq(salesProspectsTable.id, p.id));
    }
  }
  const [fresh] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, p.id));
  res.json(fresh);
});

router.delete("/prospects/:id", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  await db.delete(salesProspectsTable).where(eq(salesProspectsTable.id, p.id));
  res.json({ ok: true });
});

/** What the seller would send this shop next — written, guarded, not sent. */
router.post("/prospects/:id/preview", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  const s = await salesSettings();
  const mode = p.stage === "new" ? "opener" : "followup";
  const c = await composeFor(s, p, mode, { stepIndex: Math.min(p.step, s.steps.length - 1) });
  res.json({ mode, step: mode === "followup" ? Math.min(p.step, s.steps.length - 1) : null, ...c });
});

/** Send the next message now, without waiting for its day. */
router.post("/prospects/:id/send-now", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  const s = await salesSettings();
  if (!s.waUserId) return res.status(400).json({ error: "اختر رقم واتساب الموظف أولاً" });
  if (["trial", "won", "lost", "stopped"].includes(p.stage)) return res.status(400).json({ error: "هذا المحل خارج المتابعة" });
  const r = p.stage === "new" ? await sendOpener(s, p) : await sendFollowUp(s, p);
  res.json({ result: r, dryRun: s.dryRun });
});

/** A message the admin writes; recorded on the shop as human. */
router.post("/prospects/:id/message", async (req, res) => {
  const p = await own(req, res); if (!p) return;
  const s = await salesSettings();
  const text = String(req.body?.text ?? "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: "اكتب الرسالة" });
  if (!s.waUserId) return res.status(400).json({ error: "اختر رقم واتساب الموظف أولاً" });
  const r = await deliver({ ...s, dryRun: false }, p, "reply", { ok: true, text, linkKeys: [], by: "human", issues: [], fallback: false }, null);
  res.json({ result: r });
});

// ── Teaching ──────────────────────────────────────────────────────

router.post("/teach", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 4) return res.status(400).json({ error: "اكتب التعليمة" });
  try { await teach(text, req.body?.prospectId ? Number(req.body.prospectId) : null); }
  catch (e: any) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true });
});

router.get("/memory", async (req, res) => {
  res.json(await memoryFor(await wa(req), "sales"));
});

router.delete("/memory/:id", async (req, res) => {
  await forget(await wa(req), Number(req.params.id));
  res.json({ ok: true });
});

// ── The arena: talk to it as a shop owner ─────────────────────────

router.post("/arena", async (req, res) => {
  const s = await salesSettings();
  const b = req.body ?? {};
  const turns = (Array.isArray(b.turns) ? b.turns : []).slice(-16)
    .map((t: any) => ({ role: t?.role === "assistant" ? "assistant" as const : "user" as const, content: String(t?.content ?? "").slice(0, 1500) }))
    .filter((t: any) => t.content.trim());
  const fake = {
    id: -1, waUserId: s.waUserId ?? 0, phone: "0", token: "ARENA000", name: String(b.name ?? "").slice(0, 80) || null, business: String(b.business ?? "").slice(0, 120) || "مطعم التجربة",
    vertical: b.vertical in VERTICAL_AR ? b.vertical : "restaurant", city: String(b.city ?? "").slice(0, 60) || null, stage: turns.some((t: any) => t.role === "user") ? "replied" : "new",
    step: 0, replies: turns.filter((t: any) => t.role === "user").length, clicks: 0, facts: [], summary: null, linksSent: [],
  } as any;
  const mode = turns.length === 0 ? "opener" : turns[turns.length - 1].role === "user" ? "reply" : "followup";
  const c = await composeFor(s, fake, mode, { history: turns, incoming: mode === "reply" ? turns[turns.length - 1].content : undefined, stepIndex: 0 });
  res.json({ mode, ...c });
});

// ── Numbers and the engine ────────────────────────────────────────

router.get("/stats", async (_req, res) => {
  const s = await salesSettings();
  const stats = await salesStats(s);
  res.json({ stats, openers: s.waUserId ? await recentOpeners(s.waUserId) : [], closed: closedReason(s, new Date()) });
});

/** One cycle now — for checking the setup; spacing ignored, at most five openers. */
router.post("/tick", async (_req, res) => {
  res.json(await salesTick(new Date(), { ignoreSpacing: true, maxOpeners: 5 }));
});

export default router;
