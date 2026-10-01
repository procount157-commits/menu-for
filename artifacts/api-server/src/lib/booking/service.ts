// ── Bookings ──────────────────────────────────────────────────────
// A table, an appointment, or a tray to collect on Thursday: a time, a size
// and a name. Capacity is checked under a per-branch advisory lock, so two
// people taking the last slot at once get one booking and one "just taken".

import { and, asc, eq, gte, inArray, lt, isNull, lte, sql } from "drizzle-orm";
import {
  db, bookingsTable, bookingSettingsTable, branchesTable, orgsTable, menuItemsTable, queuesTable,
  type Booking, type BookingSettings, type Org, type Branch,
} from "@workspace/db";
import {
  availableSlots, fits, waMeLink, formatClock, formatDayLabel, localDate, addDays,
  type PublicBookingView, type Slot,
} from "@workspace/menu-shared";
import { freshCode, todayFor, queueCtx, join } from "../queue/engine";
import { token as newToken } from "../tenancy/org";
import { publish } from "../realtime";
import { touchCustomer, normalisePhone } from "../customers";
import { enqueue, cancelQueued } from "../notify/outbox";
import { renderFor, type TemplateKey } from "../notify/templates";
import { publicUrl, bookingPath } from "../menu/urls";
import { logger } from "../logger";

export class BookingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const LIVE = ["pending", "confirmed", "arrived"];

export async function settingsFor(branchId: number): Promise<BookingSettings> {
  const [s] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.branchId, branchId)).limit(1);
  if (s) return s;
  const [c] = await db.insert(bookingSettingsTable).values({ branchId }).onConflictDoNothing().returning();
  return c ?? (await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.branchId, branchId)).limit(1))[0]!;
}

async function serviceDuration(orgId: number, itemId?: number | null): Promise<{ id: number; name: string; nameEn: string | null; durationMin: number | null } | null> {
  if (!itemId) return null;
  const [i] = await db.select({ id: menuItemsTable.id, name: menuItemsTable.name, nameEn: menuItemsTable.nameEn, durationMin: menuItemsTable.durationMin })
    .from(menuItemsTable).where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.orgId, orgId), eq(menuItemsTable.isActive, true))).limit(1);
  return i ?? null;
}

async function dayBookings(branchId: number, from: Date, to: Date) {
  return db.select({ startsAt: bookingsTable.startsAt, endsAt: bookingsTable.endsAt }).from(bookingsTable).where(and(
    eq(bookingsTable.branchId, branchId), inArray(bookingsTable.status, LIVE),
    lt(bookingsTable.startsAt, to), gte(bookingsTable.endsAt, from),
  ));
}

export async function slotsFor(org: Org, branch: Branch, date: string, opts: { itemId?: number | null; partySize?: number } = {}): Promise<Slot[]> {
  const s = await settingsFor(branch.id);
  if (!s.enabled) return [];
  const today = localDate(org.timezone);
  if (date < today || date > addDays(today, s.maxDaysAhead)) return [];
  if ((opts.partySize ?? 1) > s.maxParty) return [];
  const svc = await serviceDuration(org.id, opts.itemId);
  const from = new Date(`${addDays(date, -1)}T00:00:00Z`), to = new Date(`${addDays(date, 2)}T00:00:00Z`);
  const existing = await dayBookings(branch.id, from, to);
  return availableSlots(date, branch.hours ?? {}, org.timezone, {
    slotMin: s.slotMin, capacityPerSlot: s.capacityPerSlot, leadTimeMin: s.leadTimeMin, durationMin: svc?.durationMin ?? null,
  }, existing);
}

export interface NewBooking {
  startsAt: string;
  customerName: string;
  phone?: string | null;
  partySize?: number;
  itemId?: number | null;
  notes?: string | null;
  marketingOptIn?: boolean;
  source?: string;
}

export function bookingMessage(b: Pick<Booking, "code">, lang: "ar" | "en" = "ar") {
  return lang === "ar" ? `تأكيد حجز\nرمز ${b.code}` : `Confirm booking\ncode ${b.code}`;
}

export async function createBooking(org: Org, branch: Branch, input: NewBooking, opts: { staff?: boolean } = {}): Promise<Booking> {
  const s = await settingsFor(branch.id);
  if (!s.enabled && !opts.staff) throw new BookingError(409, "الحجز غير متاح في هذا الفرع");
  const name = String(input.customerName ?? "").trim().slice(0, 80);
  if (!name) throw new BookingError(400, "اكتب الاسم");
  const partySize = Math.max(1, Math.min(50, Math.floor(Number(input.partySize) || 1)));
  if (!opts.staff && partySize > s.maxParty) throw new BookingError(400, `أقصى عدد للحجز ${s.maxParty} — تواصل معنا للمجموعات الكبيرة`);
  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime())) throw new BookingError(400, "اختر الموعد");
  const svc = await serviceDuration(org.id, input.itemId);
  const holdMin = svc?.durationMin || s.slotMin;
  const end = new Date(start.getTime() + holdMin * 60_000);
  const phone = normalisePhone(input.phone, org.currency);

  if (!opts.staff) {
    // The slot must be one the page could have offered.
    const offered = await slotsFor(org, branch, localDate(org.timezone, start), { itemId: input.itemId, partySize });
    if (!offered.some((x) => new Date(x.start).getTime() === start.getTime())) throw new BookingError(409, "هذا الموعد لم يعد متاحاً — اختر غيره");
  }
  const code = await freshCode(org.id, todayFor(org));
  const b = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${7_000_000 + branch.id})`);
    const existing = await tx.select({ startsAt: bookingsTable.startsAt, endsAt: bookingsTable.endsAt }).from(bookingsTable).where(and(
      eq(bookingsTable.branchId, branch.id), inArray(bookingsTable.status, LIVE), lt(bookingsTable.startsAt, end), gte(bookingsTable.endsAt, start),
    ));
    if (!opts.staff && !fits(start, { slotMin: s.slotMin, capacityPerSlot: s.capacityPerSlot, leadTimeMin: 0, durationMin: holdMin }, existing)) {
      throw new BookingError(409, "هذا الموعد امتلأ للتو — اختر غيره");
    }
    const [row] = await tx.insert(bookingsTable).values({
      orgId: org.id, branchId: branch.id, code, token: newToken(16), customerName: name, phone, phoneVerified: false,
      partySize, itemId: svc?.id ?? null, startsAt: start, endsAt: end,
      status: s.autoConfirm || opts.staff ? "confirmed" : "pending",
      notes: String(input.notes ?? "").trim().slice(0, 500) || null,
      source: opts.staff ? "staff" : (input.source ?? "link").slice(0, 12), marketingOptIn: !!input.marketingOptIn,
    }).returning();
    return row!;
  });
  publish(`bookings:${branch.id}`);
  if (phone) {
    await touchCustomer(org.id, phone, { name, booking: true, optIn: b.marketingOptIn, branchId: branch.id });
    if (b.status === "confirmed") await notifyBooking(b, "booking_confirmed");
  }
  return b;
}

export async function bookingByToken(token: string): Promise<Booking | null> {
  const [b] = await db.select().from(bookingsTable).where(eq(bookingsTable.token, token)).limit(1);
  return b ?? null;
}

async function ctxOf(b: Booking) {
  const rows = await db.select({ branch: branchesTable, org: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId)).where(eq(branchesTable.id, b.branchId)).limit(1);
  return rows[0] ?? null;
}

function whenText(b: Booking, org: Org, lang: "ar" | "en") {
  const d = localDate(org.timezone, b.startsAt);
  return `${formatDayLabel(d, org.timezone, lang)} ${formatClock(b.startsAt, org.timezone, lang)}`;
}

export async function bookingView(b: Booking): Promise<PublicBookingView | null> {
  const c = await ctxOf(b);
  if (!c) return null;
  const lang = c.org.defaultLang === "en" ? "en" : "ar";
  const svc = b.itemId ? await serviceDuration(c.org.id, b.itemId) : null;
  return {
    code: b.code, token: b.token, status: b.status, customerName: b.customerName, partySize: b.partySize,
    startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
    service: svc ? (lang === "en" && svc.nameEn ? svc.nameEn : svc.name) : null,
    whatsappLinked: b.phoneVerified,
    waLink: waMeLink(c.branch.waPhone, bookingMessage(b, lang)),
    org: { name: c.org.name, nameEn: c.org.nameEn, slug: c.org.slug, logoUrl: c.org.logoUrl, theme: c.org.theme, vertical: c.org.vertical as any, currency: c.org.currency, defaultLang: lang, timezone: c.org.timezone },
    branch: { name: c.branch.name, nameEn: c.branch.nameEn, slug: c.branch.slug, address: c.branch.address, mapUrl: c.branch.mapUrl },
  };
}

export async function notifyBooking(b: Booking, key: TemplateKey, at?: Date) {
  if (!b.phone) return;
  const c = await ctxOf(b);
  if (!c) return;
  const lang = c.org.defaultLang === "en" ? "en" : "ar";
  const svc = b.itemId ? await serviceDuration(c.org.id, b.itemId) : null;
  const details = [
    svc ? (lang === "en" && svc.nameEn ? svc.nameEn : svc.name) : null,
    lang === "ar" ? `عدد الأشخاص: ${b.partySize}` : `Party of ${b.partySize}`,
  ].filter(Boolean).join("\n");
  const text = await renderFor(c.org.id, key, lang, {
    name: b.customerName, number: b.code, eta: whenText(b, c.org, lang), details,
    branch: lang === "en" ? (c.branch.nameEn || c.branch.name) : c.branch.name,
    shop: lang === "en" ? (c.org.nameEn || c.org.name) : c.org.name,
    link: publicUrl(bookingPath(b.token)),
  });
  await enqueue({ org: c.org, waUserId: c.branch.waUserId, phone: b.phone, kind: key, text, refType: "booking", refId: b.id, consented: !b.phoneVerified, at });
}

export async function confirmBookingFromWhatsApp(b: Booking, phone: string): Promise<Booking> {
  const firstTime = !b.phoneVerified;
  const [u] = await db.update(bookingsTable).set({ phone, phoneVerified: true }).where(eq(bookingsTable.id, b.id)).returning();
  if (firstTime) {
    if (!b.phone) await touchCustomer(b.orgId, phone, { name: b.customerName, booking: true, optIn: b.marketingOptIn, branchId: b.branchId });
    await notifyBooking(u!, "booking_confirmed");
  }
  publish(`bookings:${b.branchId}`);
  return u!;
}

export async function setBookingStatus(b: Booking, status: string, opts: { byCustomer?: boolean } = {}): Promise<Booking> {
  const allowed = opts.byCustomer ? ["cancelled"] : ["pending", "confirmed", "arrived", "done", "cancelled", "no_show"];
  if (!allowed.includes(status)) throw new BookingError(400, "حالة غير مسموحة");
  if (opts.byCustomer && !LIVE.includes(b.status)) throw new BookingError(409, "لا يمكن إلغاء هذا الحجز");
  const [u] = await db.update(bookingsTable).set({ status }).where(eq(bookingsTable.id, b.id)).returning();
  if (status === "cancelled" || status === "no_show" || status === "done") await cancelQueued("booking", b.id);
  if (status === "cancelled") await notifyBooking(u!, "booking_cancelled");
  if (status === "confirmed" && b.status === "pending") await notifyBooking(u!, "booking_confirmed");
  if (status === "no_show" && u!.phone) await touchCustomer(b.orgId, u!.phone, { noShow: true });
  if (status === "done" && u!.phone) await touchCustomer(b.orgId, u!.phone, { visit: true, branchId: b.branchId });
  publish(`bookings:${b.branchId}`);
  return u!;
}

/**
 * A booked guest has arrived: they go into today's queue at the front, so a
 * reservation means something on a busy night.
 */
export async function checkIn(b: Booking, staffId: number | null) {
  const c = await ctxOf(b);
  if (!c) throw new BookingError(404, "الفرع غير موجود");
  const [q] = await db.select().from(queuesTable)
    .where(and(eq(queuesTable.branchId, b.branchId), eq(queuesTable.isActive, true)))
    .orderBy(asc(queuesTable.sort), asc(queuesTable.id)).limit(1);
  await setBookingStatus(b, "arrived");
  if (!q) return null;
  const ctx = await queueCtx(q.id);
  if (!ctx) return null;
  return join(ctx, {
    name: b.customerName, partySize: b.partySize, phone: b.phone, source: "booking", priority: 5,
    bookingId: b.id, staffId, note: `حجز ${b.code}`, consented: !!b.phone,
  });
}

export async function listBookings(orgId: number, branchIds: number[], from: Date, to: Date) {
  return db.select().from(bookingsTable).where(and(
    eq(bookingsTable.orgId, orgId), inArray(bookingsTable.branchId, branchIds),
    gte(bookingsTable.startsAt, from), lt(bookingsTable.startsAt, to),
  )).orderBy(asc(bookingsTable.startsAt));
}

// ── Reminders ─────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export async function sendDueReminders(now = new Date()): Promise<number> {
  const rows = await db.select({ b: bookingsTable, s: bookingSettingsTable }).from(bookingsTable)
    .innerJoin(bookingSettingsTable, eq(bookingSettingsTable.branchId, bookingsTable.branchId))
    .where(and(
      eq(bookingsTable.status, "confirmed"), isNull(bookingsTable.reminderSentAt),
      gte(bookingsTable.startsAt, now), lte(bookingsTable.startsAt, new Date(now.getTime() + 48 * 3_600_000)),
    ));
  let n = 0;
  for (const { b, s } of rows) {
    if (!b.phone || s.reminderBeforeMin <= 0) continue;
    if (b.startsAt.getTime() - now.getTime() > s.reminderBeforeMin * 60_000) continue;
    // Booked inside the reminder window: the confirmation was the reminder.
    if (b.startsAt.getTime() - b.createdAt.getTime() < s.reminderBeforeMin * 60_000 + 30 * 60_000) {
      await db.update(bookingsTable).set({ reminderSentAt: now }).where(eq(bookingsTable.id, b.id));
      continue;
    }
    await db.update(bookingsTable).set({ reminderSentAt: now }).where(eq(bookingsTable.id, b.id));
    await notifyBooking(b, "booking_reminder");
    n++;
  }
  return n;
}

export function startBookingReminders() {
  if (timer) return;
  timer = setInterval(() => { sendDueReminders().catch((err) => logger.warn({ err: String(err?.message ?? err) }, "booking reminders failed")); }, 60_000);
  timer.unref?.();
}
