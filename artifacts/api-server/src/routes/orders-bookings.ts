// ── /api/orders, /api/bookings, /api/booking-settings ─────────────

import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, bookingsTable, bookingSettingsTable } from "@workspace/db";
import { localDate, addDays, zonedToUtc } from "@workspace/menu-shared";
import { requireAuth } from "../lib/auth";
import { withTenant, ALL, MANAGERS } from "../lib/tenancy/context";
import { listOrders, setOrderStatus, OrderError, orderMessage } from "../lib/orders/service";
import { listBookings, setBookingStatus, createBooking, checkIn, settingsFor, slotsFor, BookingError } from "../lib/booking/service";
import { stream } from "../lib/realtime";
import { assertFeature } from "../lib/plans";
import { QueueError } from "../lib/queue/engine";

const router = Router();

// ── Orders ────────────────────────────────────────────────────────

const orderRow = (o: Awaited<ReturnType<typeof listOrders>>[number]) => ({ ...o, subtotal: Number(o.subtotal) });

router.get("/orders", requireAuth, withTenant(ALL, async (req, res, t) => {
  const status = req.query.status ? String(req.query.status).split(",") : undefined;
  const rows = await listOrders(t.org.id, [t.branch.id], { status, sinceHours: Number(req.query.hours) || 36 });
  res.json(rows.map(orderRow));
}));

router.get("/orders/stream", requireAuth, withTenant(ALL, async (req, res, t) => {
  const branchId = t.branch.id, orgId = t.org.id;
  stream(req, res, [`orders:${branchId}`], async () => (await listOrders(orgId, [branchId], { sinceHours: 36 })).map(orderRow));
}));

router.patch("/orders/:id", requireAuth, withTenant(ALL, async (req, res, t) => {
  try {
    const o = await setOrderStatus(t.org.id, t.branchIds, Number(req.params.id), String(req.body?.status));
    res.json(orderRow(o));
  } catch (err) {
    if (err instanceof OrderError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

router.get("/orders/:id/text", requireAuth, withTenant(ALL, async (req, res, t) => {
  const rows = await listOrders(t.org.id, t.branchIds, { sinceHours: 24 * 90, limit: 5000 });
  const o = rows.find((r) => r.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
  res.json({ text: orderMessage(o, t.org, t.org.defaultLang === "en" ? "en" : "ar") });
}));

// ── Bookings ──────────────────────────────────────────────────────

function range(req: any, tz: string) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : localDate(tz);
  const days = Math.max(1, Math.min(62, Number(req.query.days) || 7));
  return { from: zonedToUtc(tz, from, "00:00"), to: zonedToUtc(tz, addDays(from, days), "04:00") };
}

router.get("/bookings", requireAuth, withTenant(ALL, async (req, res, t) => {
  const { from, to } = range(req, t.org.timezone);
  res.json(await listBookings(t.org.id, [t.branch.id], from, to));
}));

router.get("/bookings/stream", requireAuth, withTenant(ALL, async (req, res, t) => {
  const { from, to } = range(req, t.org.timezone);
  const branchId = t.branch.id, orgId = t.org.id;
  stream(req, res, [`bookings:${branchId}`], () => listBookings(orgId, [branchId], from, to));
}));

router.get("/bookings/slots", requireAuth, withTenant(ALL, async (req, res, t) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : localDate(t.org.timezone);
  res.json({ date, slots: await slotsFor(t.org, t.branch, date, { itemId: req.query.item ? Number(req.query.item) : null, partySize: Number(req.query.party) || 1 }) });
}));

router.post("/bookings", requireAuth, withTenant(ALL, async (req, res, t) => {
  try {
    const b = await createBooking(t.org, t.branch, { ...(req.body ?? {}), source: "staff" }, { staff: true });
    res.status(201).json(b);
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

async function ownBooking(orgId: number, branchIds: number[], id: number) {
  const [b] = await db.select().from(bookingsTable).where(and(eq(bookingsTable.id, id), eq(bookingsTable.orgId, orgId), inArray(bookingsTable.branchId, branchIds))).limit(1);
  return b ?? null;
}

router.patch("/bookings/:id", requireAuth, withTenant(ALL, async (req, res, t) => {
  const b = await ownBooking(t.org.id, t.branchIds, Number(req.params.id));
  if (!b) return res.status(404).json({ error: "الحجز غير موجود" });
  try { res.json(await setBookingStatus(b, String(req.body?.status))); }
  catch (err) { if (err instanceof BookingError) return res.status(err.status).json({ error: err.message }); throw err; }
}));

router.post("/bookings/:id/check-in", requireAuth, withTenant(ALL, async (req, res, t) => {
  const b = await ownBooking(t.org.id, t.branchIds, Number(req.params.id));
  if (!b) return res.status(404).json({ error: "الحجز غير موجود" });
  try { res.json({ ticket: await checkIn(b, t.staffId) }); }
  catch (err) {
    if (err instanceof BookingError || err instanceof QueueError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

// ── Settings ──────────────────────────────────────────────────────

router.get("/booking-settings", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  res.json(await settingsFor(t.branch.id));
}));

router.patch("/booking-settings", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const b = req.body ?? {};
  const p: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.enabled === "boolean") {
    if (b.enabled) await assertFeature(t.org.ownerUserId, "booking");
    p.enabled = b.enabled;
  }
  if (typeof b.autoConfirm === "boolean") p.autoConfirm = b.autoConfirm;
  const int = (k: string, lo: number, hi: number) => { if (k in b && Number.isFinite(Number(b[k]))) p[k] = Math.max(lo, Math.min(hi, Math.round(Number(b[k])))); };
  int("slotMin", 5, 240); int("capacityPerSlot", 1, 500); int("leadTimeMin", 0, 14 * 24 * 60); int("maxDaysAhead", 0, 180); int("maxParty", 1, 100); int("reminderBeforeMin", 0, 48 * 60);
  await settingsFor(t.branch.id);
  const [s] = await db.update(bookingSettingsTable).set(p).where(eq(bookingSettingsTable.branchId, t.branch.id)).returning();
  const { publish } = await import("../lib/realtime");
  publish(`branch:${t.branch.id}`);
  res.json(s);
}));

export default router;
