// ── /api/public — the pages a customer opens with no sign-up ──────
// Nothing here returns a phone number or another customer's name.

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, gt } from "drizzle-orm";
import { db, branchesTable, orgsTable, queuesTable, offersTable, queueTicketsTable, type Org, type Branch } from "@workspace/db";
import { waMeLink, localDate, type PublicDisplay } from "@workspace/menu-shared";
import { orgBySlug, branchFor, publicMenu } from "../lib/menu/service";
import {
  queueCtx, publicQueue, join, ticketByToken, ticketView, transition, joinMessage, snapshot, etaAt, QueueError,
} from "../lib/queue/engine";
import { createOrder, orderByToken, orderView, orderMessage, OrderError } from "../lib/orders/service";
import { slotsFor, createBooking, bookingByToken, bookingView, bookingMessage, setBookingStatus, BookingError } from "../lib/booking/service";
import { normalisePhone } from "../lib/customers";
import { stream } from "../lib/realtime";
import { limit } from "../lib/rate-limit";
import { rememberOrigin, joinKey, publicUrl, menuPath } from "../lib/menu/urls";
import { menuPlan } from "../lib/plans";

const router = Router();

router.use((req, _res, next) => { rememberOrigin(req); next(); });

function fail(res: Response, err: unknown) {
  if (err instanceof QueueError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof OrderError || err instanceof BookingError) return res.status(err.status).json({ error: err.message });
  throw err;
}

/** A device id in a cookie: one live ticket per phone per queue, with no account. */
function deviceId(req: Request, res: Response): string {
  const raw = String(req.headers.cookie ?? "").match(/(?:^|;\s*)mfy_dev=([A-Za-z0-9_-]{16,40})/)?.[1];
  if (raw) return raw;
  const id = crypto.randomBytes(15).toString("base64url");
  res.cookie("mfy_dev", id, { httpOnly: true, sameSite: "lax", secure: "auto" as any, maxAge: 400 * 24 * 3_600_000, path: "/" });
  return id;
}

async function shop(slug: string, branchSlug?: string): Promise<{ org: Org; branch: Branch } | null> {
  const org = await orgBySlug(slug);
  if (!org || org.status !== "active") return null;
  const branch = await branchFor(org, branchSlug || null);
  return branch ? { org, branch } : null;
}

// ── Menu ──────────────────────────────────────────────────────────

router.get("/m/:slug{/:branch}", limit("menu", 240, 60_000), async (req, res) => {
  const s = await shop(String(req.params.slug), req.params.branch ? String(req.params.branch) : undefined);
  if (!s) return res.status(404).json({ error: "المحل غير موجود" });
  res.setHeader("Cache-Control", "no-cache");
  res.json(await publicMenu(s.org, s.branch));
});

// ── Queue ─────────────────────────────────────────────────────────

router.get("/queues/:id", limit("queue-read", 600, 60_000), async (req, res) => {
  const ctx = await queueCtx(Number(req.params.id));
  if (!ctx || !ctx.queue.isActive) return res.status(404).json({ error: "الصف غير موجود" });
  res.json(await publicQueue(ctx));
});

router.get("/queues/:id/stream", limit("stream", 120, 60_000), async (req, res) => {
  const id = Number(req.params.id);
  const ctx = await queueCtx(id);
  if (!ctx || !ctx.queue.isActive) return res.status(404).json({ error: "الصف غير موجود" });
  stream(req, res, [`queue:${id}`], async () => {
    const c = await queueCtx(id);
    return c ? publicQueue(c) : null;
  });
});

router.post("/queues/:id/join", limit("join", 12, 10 * 60_000), async (req, res) => {
  const ctx = await queueCtx(Number(req.params.id));
  if (!ctx || !ctx.queue.isActive || ctx.org.status !== "active") return res.status(404).json({ error: "الصف غير موجود" });
  const plan = await menuPlan(ctx.org.ownerUserId);
  if (!plan.features.queue) return res.status(403).json({ error: "الصف الرقمي غير مفعّل لهذا المحل" });
  const b = req.body ?? {};
  const phone = normalisePhone(b.phone, ctx.org.currency);
  if (b.phone && !phone) return res.status(400).json({ error: "رقم الواتساب غير صحيح" });
  try {
    const t = await join(ctx, {
      name: b.name, partySize: b.partySize, phone, consented: !!phone,
      serviceItemId: b.serviceItemId ? Number(b.serviceItemId) : null,
      source: b.source === "qr" ? "qr" : "link",
      deviceId: deviceId(req, res), joinKey: b.joinKey ?? null, marketingOptIn: !!b.marketingOptIn,
    });
    const lang = ctx.org.defaultLang === "en" ? "en" : "ar";
    res.status(201).json({
      token: t.token, displayCode: t.displayCode, joinCode: t.joinCode,
      waLink: waMeLink(ctx.branch.waPhone, joinMessage(t, lang)),
    });
  } catch (err) { fail(res, err); }
});

router.get("/tickets/:token", limit("ticket", 600, 60_000), async (req, res) => {
  const t = await ticketByToken(String(req.params.token));
  if (!t) return res.status(404).json({ error: "التذكرة غير موجودة" });
  res.setHeader("Cache-Control", "no-store");
  res.json(await ticketView(t));
});

router.get("/tickets/:token/stream", limit("stream", 120, 60_000), async (req, res) => {
  const tok = String(req.params.token);
  const t = await ticketByToken(tok);
  if (!t) return res.status(404).json({ error: "التذكرة غير موجودة" });
  stream(req, res, [`queue:${t.queueId}`], async () => {
    const fresh = await ticketByToken(tok);
    return fresh ? ticketView(fresh) : null;
  });
});

for (const [path, action] of [["leave", "left"], ["on-my-way", "on_my_way"]] as const) {
  router.post(`/tickets/:token/${path}`, limit("ticket-act", 30, 10 * 60_000), async (req, res) => {
    const t = await ticketByToken(String(req.params.token));
    if (!t) return res.status(404).json({ error: "التذكرة غير موجودة" });
    const ctx = await queueCtx(t.queueId);
    if (!ctx) return res.status(404).json({ error: "الصف غير موجود" });
    try {
      const u = await transition(ctx, t.id, action, null);
      res.json(await ticketView(u));
    } catch (err) { fail(res, err); }
  });
}

// ── Orders ────────────────────────────────────────────────────────

router.post("/orders", limit("order", 20, 10 * 60_000), async (req, res) => {
  const b = req.body ?? {};
  const s = await shop(String(b.slug ?? ""), b.branch ? String(b.branch) : undefined);
  if (!s) return res.status(404).json({ error: "المحل غير موجود" });
  try {
    const o = await createOrder(s.org, s.branch, {
      lines: b.lines, type: b.type, tableLabel: b.tableLabel, customerName: b.customerName,
      phone: b.phone, address: b.address, notes: b.notes, scheduledFor: b.scheduledFor, marketingOptIn: !!b.marketingOptIn,
    });
    const lang = b.lang === "en" ? "en" : (s.org.defaultLang === "en" ? "en" : "ar");
    res.status(201).json({ code: o.code, token: o.token, subtotal: Number(o.subtotal), waLink: waMeLink(s.branch.waPhone, orderMessage(o, s.org, lang)) });
  } catch (err) { fail(res, err); }
});

router.get("/orders/:token", limit("ticket", 600, 60_000), async (req, res) => {
  const o = await orderByToken(String(req.params.token));
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  res.setHeader("Cache-Control", "no-store");
  res.json(await orderView(o));
});

router.get("/orders/:token/stream", limit("stream", 120, 60_000), async (req, res) => {
  const tok = String(req.params.token);
  const o = await orderByToken(tok);
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  stream(req, res, [`orders:${o.branchId}`], async () => {
    const f = await orderByToken(tok);
    return f ? orderView(f) : null;
  });
});

// ── Bookings ──────────────────────────────────────────────────────

router.get("/bookings/slots", limit("slots", 120, 60_000), async (req, res) => {
  const s = await shop(String(req.query.slug ?? ""), req.query.branch ? String(req.query.branch) : undefined);
  if (!s) return res.status(404).json({ error: "المحل غير موجود" });
  const plan = await menuPlan(s.org.ownerUserId);
  if (!plan.features.booking) return res.json({ date: null, slots: [] });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : localDate(s.org.timezone);
  const slots = await slotsFor(s.org, s.branch, date, {
    itemId: req.query.item ? Number(req.query.item) : null, partySize: Number(req.query.party) || 1,
  });
  res.json({ date, slots });
});

router.post("/bookings", limit("booking", 10, 10 * 60_000), async (req, res) => {
  const b = req.body ?? {};
  const s = await shop(String(b.slug ?? ""), b.branch ? String(b.branch) : undefined);
  if (!s) return res.status(404).json({ error: "المحل غير موجود" });
  const plan = await menuPlan(s.org.ownerUserId);
  if (!plan.features.booking) return res.status(403).json({ error: "الحجز غير مفعّل لهذا المحل" });
  if (b.phone && !normalisePhone(b.phone, s.org.currency)) return res.status(400).json({ error: "رقم الواتساب غير صحيح" });
  try {
    const bk = await createBooking(s.org, s.branch, {
      startsAt: b.startsAt, customerName: b.customerName, phone: b.phone, partySize: b.partySize,
      itemId: b.itemId ? Number(b.itemId) : null, notes: b.notes, marketingOptIn: !!b.marketingOptIn,
    });
    const lang = s.org.defaultLang === "en" ? "en" : "ar";
    res.status(201).json({ code: bk.code, token: bk.token, status: bk.status, waLink: waMeLink(s.branch.waPhone, bookingMessage(bk, lang)) });
  } catch (err) { fail(res, err); }
});

router.get("/bookings/:token", limit("ticket", 600, 60_000), async (req, res) => {
  const b = await bookingByToken(String(req.params.token));
  if (!b) return res.status(404).json({ error: "الحجز غير موجود" });
  res.setHeader("Cache-Control", "no-store");
  res.json(await bookingView(b));
});

router.post("/bookings/:token/cancel", limit("ticket-act", 30, 10 * 60_000), async (req, res) => {
  const b = await bookingByToken(String(req.params.token));
  if (!b) return res.status(404).json({ error: "الحجز غير موجود" });
  try {
    const u = await setBookingStatus(b, "cancelled", { byCustomer: true });
    res.json(await bookingView(u));
  } catch (err) { fail(res, err); }
});

// ── The shop's TV ─────────────────────────────────────────────────

async function displayView(token: string): Promise<PublicDisplay | null> {
  const rows = await db.select({ b: branchesTable, o: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId))
    .where(eq(branchesTable.displayToken, token)).limit(1);
  const r = rows[0];
  if (!r || !r.b.isActive) return null;
  const { b: branch, o: org } = r;
  const now = new Date();
  const qs = await db.select().from(queuesTable).where(and(eq(queuesTable.branchId, branch.id), eq(queuesTable.isActive, true))).orderBy(asc(queuesTable.sort), asc(queuesTable.id));
  const queues = await Promise.all(qs.map(async (q) => {
    const s = await snapshot({ queue: q, branch, org });
    return {
      id: q.id, name: q.name, nameEn: q.nameEn,
      nowServing: s.called.slice(0, 4).map((t) => t.displayCode),
      next: s.waiting.slice(0, 6).map((t) => t.displayCode),
      waiting: s.waiting.length, eta: etaAt(s, s.waiting.length), isPaused: q.isPaused, isOpen: q.isOpen,
    };
  }));
  const offers = await db.select().from(offersTable).where(and(
    eq(offersTable.orgId, org.id), eq(offersTable.isActive, true),
    or(isNull(offersTable.branchId), eq(offersTable.branchId, branch.id)),
    or(isNull(offersTable.startsAt), lte(offersTable.startsAt, now)),
    or(isNull(offersTable.endsAt), gt(offersTable.endsAt, now)),
  )).orderBy(asc(offersTable.sort));
  const key = joinKey(branch.displayToken);
  return {
    org: { name: org.name, nameEn: org.nameEn, logoUrl: org.logoUrl, theme: org.theme, slug: org.slug },
    branch: { name: branch.name, nameEn: branch.nameEn, slug: branch.slug },
    queues,
    offers: offers.map((o) => ({ id: o.id, title: o.title, titleEn: o.titleEn, body: o.body, bodyEn: o.bodyEn, imageUrl: o.imageUrl, itemId: o.itemId, endsAt: o.endsAt?.toISOString() ?? null })),
    joinKey: key,
    joinUrl: publicUrl(`${menuPath(org.slug, branch.slug)}?k=${key}&src=qr#queue`),
  };
}

router.get("/display/:token", limit("display", 600, 60_000), async (req, res) => {
  const v = await displayView(String(req.params.token));
  if (!v) return res.status(404).json({ error: "الشاشة غير موجودة" });
  res.json(v);
});

router.get("/display/:token/stream", limit("stream", 120, 60_000), async (req, res) => {
  const tok = String(req.params.token);
  const v = await displayView(tok);
  if (!v) return res.status(404).json({ error: "الشاشة غير موجودة" });
  const [b] = await db.select({ id: branchesTable.id }).from(branchesTable).where(eq(branchesTable.displayToken, tok)).limit(1);
  stream(req, res, [`branch:${b!.id}`], () => displayView(tok));
});

/** The TV's join QR, as an image: no QR library in the public bundle. */
router.get("/display/:token/qr.png", limit("display", 600, 60_000), async (req, res) => {
  const v = await displayView(String(req.params.token));
  if (!v) return res.status(404).end();
  const QRCode = (await import("qrcode")).default;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=240");
  res.send(await QRCode.toBuffer(v.joinUrl, { errorCorrectionLevel: "M", margin: 1, width: 520 }));
});

export { displayView };
export default router;
