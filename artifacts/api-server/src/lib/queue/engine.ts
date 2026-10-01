// ── The digital queue ─────────────────────────────────────────────
// A ticket is taken from the link or the shop's QR with no sign-up, shows its
// place and wait live, and is called with one button. Three things matter
// more than anything else here:
//
//   • Two staff pressing «التالي» at the same instant never call the same
//     person: the next ticket is claimed with FOR UPDATE SKIP LOCKED.
//   • Numbers are handed out by an UPDATE … RETURNING on a per-day counter,
//     never MAX()+1, so two joins in the same millisecond get two numbers.
//   • The wait shown is measured from today's calls (lib/menu-shared eta.ts),
//     shown as a range, and recorded at join so its accuracy can be reported.

import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db, queuesTable, queueTicketsTable, queueEventsTable, queueCountersTable, branchesTable, orgsTable,
  ordersTable, bookingsTable,
  type Queue, type QueueTicket, type Org, type Branch,
} from "@workspace/db";
import {
  serviceInterval, etaFor, formatEta, randomCode, serviceDay, waMeLink,
  type EtaRange, type PublicTicket, type PublicQueue,
} from "@workspace/menu-shared";
import { publish } from "../realtime";
import { token as newToken } from "../tenancy/org";
import { touchCustomer } from "../customers";
import { enqueue, cancelQueued } from "../notify/outbox";
import { renderFor, type TemplateKey } from "../notify/templates";
import { publicUrl, ticketPath, menuPath, joinKeyValid } from "../menu/urls";
import { logger } from "../logger";

export const ACTIVE: QueueTicket["status"][] = ["waiting", "called", "serving"];

export class QueueError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export interface QueueCtx { queue: Queue; branch: Branch; org: Org }

export async function queueCtx(queueId: number): Promise<QueueCtx | null> {
  const rows = await db.select({ q: queuesTable, b: branchesTable, o: orgsTable }).from(queuesTable)
    .innerJoin(branchesTable, eq(branchesTable.id, queuesTable.branchId))
    .innerJoin(orgsTable, eq(orgsTable.id, queuesTable.orgId))
    .where(eq(queuesTable.id, queueId)).limit(1);
  const r = rows[0];
  return r ? { queue: r.q, branch: r.b, org: r.o } : null;
}

export const todayFor = (org: Pick<Org, "timezone">, at = new Date()) => serviceDay(org.timezone, at);

// ── Snapshot ──────────────────────────────────────────────────────

export interface Snapshot {
  queue: Queue;
  day: string;
  waiting: QueueTicket[];
  called: QueueTicket[];
  serving: QueueTicket[];
  interval: { minutes: number; samples: number };
  servedToday: number;
  noShowsToday: number;
  avgWaitToday: number | null;
}

export async function snapshot(ctx: QueueCtx): Promise<Snapshot> {
  const day = todayFor(ctx.org);
  const rows = await db.select().from(queueTicketsTable)
    .where(and(eq(queueTicketsTable.queueId, ctx.queue.id), eq(queueTicketsTable.serviceDay, day)))
    .orderBy(desc(queueTicketsTable.priority), asc(queueTicketsTable.number));
  const waiting = rows.filter((t) => t.status === "waiting");
  const called = rows.filter((t) => t.status === "called").sort((a, b) => +(b.calledAt ?? 0) - +(a.calledAt ?? 0));
  const serving = rows.filter((t) => t.status === "serving");
  const callTimes = rows.filter((t) => t.calledAt).map((t) => t.calledAt!.getTime());
  const served = rows.filter((t) => t.status === "done" || t.status === "serving");
  const waits = rows.filter((t) => t.calledAt).map((t) => (t.calledAt!.getTime() - t.joinedAt.getTime()) / 60_000);
  return {
    queue: ctx.queue, day, waiting, called, serving,
    interval: serviceInterval(callTimes, ctx.queue.avgServiceMin),
    servedToday: served.length,
    noShowsToday: rows.filter((t) => t.status === "no_show").length,
    avgWaitToday: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
  };
}

export function etaAt(s: Snapshot, ahead: number): EtaRange {
  return etaFor(ahead, s.interval.minutes, s.queue.etaAdjustMin);
}

export async function publicQueue(ctx: QueueCtx): Promise<PublicQueue> {
  const s = await snapshot(ctx);
  return {
    id: ctx.queue.id, name: ctx.queue.name, nameEn: ctx.queue.nameEn,
    isOpen: ctx.queue.isOpen, isPaused: ctx.queue.isPaused,
    waiting: s.waiting.length, eta: etaAt(s, s.waiting.length),
    askPartySize: ctx.queue.askPartySize, askService: ctx.queue.askService,
    qrOnly: ctx.queue.remoteJoin === "qr_only",
    full: s.waiting.length >= ctx.queue.maxWaiting,
  };
}

// ── Joining ───────────────────────────────────────────────────────

export interface JoinInput {
  name: string;
  partySize?: number;
  phone?: string | null;
  /** The customer typed a number and agreed to be told on it. */
  consented?: boolean;
  serviceItemId?: number | null;
  source?: QueueTicket["source"];
  deviceId?: string | null;
  joinKey?: string | null;
  marketingOptIn?: boolean;
  priority?: number;
  bookingId?: number | null;
  note?: string | null;
  staffId?: number | null;
}

async function codeInUse(orgId: number, code: string, day: string): Promise<boolean> {
  const since = new Date(Date.now() - 3 * 24 * 3_600_000);
  const [t] = await db.select({ id: queueTicketsTable.id }).from(queueTicketsTable)
    .where(and(eq(queueTicketsTable.orgId, orgId), eq(queueTicketsTable.joinCode, code), eq(queueTicketsTable.serviceDay, day))).limit(1);
  if (t) return true;
  const [o] = await db.select({ id: ordersTable.id }).from(ordersTable)
    .where(and(eq(ordersTable.orgId, orgId), eq(ordersTable.code, code), gte(ordersTable.createdAt, since))).limit(1);
  if (o) return true;
  const [b] = await db.select({ id: bookingsTable.id }).from(bookingsTable)
    .where(and(eq(bookingsTable.orgId, orgId), eq(bookingsTable.code, code), gte(bookingsTable.startsAt, since))).limit(1);
  return !!b;
}

/** A short code no live ticket, order or booking of the org holds. */
export async function freshCode(orgId: number, day: string, len = 4): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const c = randomCode(i < 10 ? len : len + 1);
    if (!(await codeInUse(orgId, c, day))) return c;
  }
  return randomCode(6);
}

export function joinMessage(t: Pick<QueueTicket, "displayCode" | "joinCode">, lang: "ar" | "en" = "ar"): string {
  return lang === "ar"
    ? `انضمام للصف ${t.displayCode}\nرمز ${t.joinCode}`
    : `Join queue ${t.displayCode}\ncode ${t.joinCode}`;
}

export async function join(ctx: QueueCtx, input: JoinInput): Promise<QueueTicket> {
  const { queue, org, branch } = ctx;
  const fromStaff = input.source === "staff" || input.source === "booking";
  if (!queue.isActive) throw new QueueError(404, "هذا الصف غير متاح");
  if (!fromStaff) {
    if (!queue.isOpen) throw new QueueError(409, "الصف مغلق حالياً", { closed: true });
    if (queue.isPaused) throw new QueueError(409, "الصف متوقف مؤقتاً — حاول بعد قليل", { paused: true });
    if (queue.remoteJoin === "qr_only" && !joinKeyValid(branch.displayToken, input.joinKey)) {
      throw new QueueError(403, "الانضمام لهذا الصف من داخل المحل فقط — امسح الكود على الشاشة", { qrOnly: true });
    }
  }
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name && !fromStaff) throw new QueueError(400, "اكتب اسمك");
  const partySize = Math.min(50, Math.max(1, Math.floor(Number(input.partySize) || 1)));
  const day = todayFor(org);

  // One live ticket per device per queue: tapping «احجز دورك» twice, or a
  // reload, returns the ticket already held instead of a second place.
  if (input.deviceId && !fromStaff) {
    const [held] = await db.select().from(queueTicketsTable).where(and(
      eq(queueTicketsTable.queueId, queue.id), eq(queueTicketsTable.serviceDay, day),
      eq(queueTicketsTable.deviceId, input.deviceId), inArray(queueTicketsTable.status, ACTIVE),
    )).limit(1);
    if (held) return held;
  }

  const s = await snapshot(ctx);
  if (!fromStaff && s.waiting.length >= queue.maxWaiting) throw new QueueError(409, "الصف ممتلئ حالياً — حاول بعد قليل", { full: true });

  const joinCode = await freshCode(org.id, day);
  const eta = etaAt(s, s.waiting.length);
  const ticket = await db.transaction(async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`
      INSERT INTO queue_counters (queue_id, service_day, last_number) VALUES (${queue.id}, ${day}, 1)
      ON CONFLICT (queue_id, service_day) DO UPDATE SET last_number = queue_counters.last_number + 1
      RETURNING last_number AS n`);
    const number = Number(r.rows[0]!.n);
    const [t] = await tx.insert(queueTicketsTable).values({
      orgId: org.id, branchId: branch.id, queueId: queue.id, serviceDay: day, number,
      displayCode: `${queue.prefix}-${number}`, token: newToken(16), joinCode,
      customerName: name || null, partySize,
      serviceItemId: input.serviceItemId ?? null,
      phone: input.phone ?? null, phoneVerified: false,
      status: "waiting", priority: input.priority ?? 0,
      source: input.source ?? "link", note: input.note?.slice(0, 300) ?? null,
      etaAtJoinMin: Math.round(eta.expected), bookingId: input.bookingId ?? null,
      deviceId: input.deviceId?.slice(0, 40) ?? null,
      marketingOptIn: !!input.marketingOptIn,
    }).returning();
    await tx.insert(queueEventsTable).values({ queueId: queue.id, ticketId: t!.id, type: "joined", staffId: input.staffId ?? null, detail: input.source ?? "link" });
    return t!;
  });
  publish(`queue:${queue.id}`);
  publish(`branch:${branch.id}`);

  // A typed number can be told it joined; a WhatsApp-confirmed one is told
  // when its message arrives (lib/notify/inbound.ts).
  if (ticket.phone) {
    await touchCustomer(org.id, ticket.phone, { name, optIn: ticket.marketingOptIn, branchId: branch.id });
    await notifyTicket(ctx, ticket, "queue_joined", { consented: !!input.consented });
  }
  return ticket;
}

// ── Views ─────────────────────────────────────────────────────────

export async function ticketByToken(token: string): Promise<QueueTicket | null> {
  const [t] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.token, token)).limit(1);
  return t ?? null;
}

export function aheadOf(s: Snapshot, t: QueueTicket): number {
  if (t.status !== "waiting") return 0;
  const i = s.waiting.findIndex((w) => w.id === t.id);
  return i < 0 ? 0 : i;
}

export async function ticketView(t: QueueTicket): Promise<PublicTicket | null> {
  const ctx = await queueCtx(t.queueId);
  if (!ctx) return null;
  const s = await snapshot(ctx);
  const ahead = aheadOf(s, t);
  const { org, branch, queue } = ctx;
  const lang = org.defaultLang === "en" ? "en" : "ar";
  return {
    token: t.token, displayCode: t.displayCode, joinCode: t.joinCode,
    status: t.status as PublicTicket["status"],
    ahead, eta: etaAt(s, ahead),
    partySize: t.partySize, customerName: t.customerName,
    joinedAt: t.joinedAt.toISOString(), calledAt: t.calledAt?.toISOString() ?? null,
    onMyWay: !!t.onMyWayAt,
    whatsappLinked: t.phoneVerified,
    waLink: waMeLink(branch.waPhone, joinMessage(t, lang)),
    queue: { id: queue.id, name: queue.name, nameEn: queue.nameEn, isPaused: queue.isPaused, isOpen: queue.isOpen, noShowMin: queue.noShowMin },
    nowServing: s.called.slice(0, 3).map((c) => c.displayCode),
    org: { name: org.name, nameEn: org.nameEn, slug: org.slug, logoUrl: org.logoUrl, theme: org.theme, vertical: org.vertical as any, currency: org.currency, defaultLang: lang },
    branch: { name: branch.name, nameEn: branch.nameEn, slug: branch.slug, address: branch.address, mapUrl: branch.mapUrl },
  };
}

// ── Staff actions ─────────────────────────────────────────────────

async function event(queueId: number, ticketId: number | null, type: string, staffId?: number | null, detail?: string) {
  await db.insert(queueEventsTable).values({ queueId, ticketId, type, staffId: staffId ?? null, detail: detail ?? null });
}

/** Call the next waiting ticket. Safe under concurrent presses. */
export async function callNext(ctx: QueueCtx, staffId: number | null): Promise<QueueTicket | null> {
  const day = todayFor(ctx.org);
  const r = await db.execute<{ id: number }>(sql`
    UPDATE queue_tickets SET status = 'called', called_at = now(), called_by = ${staffId}
    WHERE id = (
      SELECT id FROM queue_tickets
      WHERE queue_id = ${ctx.queue.id} AND service_day = ${day} AND status = 'waiting'
      ORDER BY priority DESC, number ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`);
  const id = r.rows[0]?.id;
  if (!id) return null;
  return afterCall(ctx, Number(id), staffId);
}

/** Call a particular ticket out of order. */
export async function callTicket(ctx: QueueCtx, ticketId: number, staffId: number | null): Promise<QueueTicket | null> {
  const r = await db.execute<{ id: number }>(sql`
    UPDATE queue_tickets SET status = 'called', called_at = now(), called_by = ${staffId}
    WHERE id = ${ticketId} AND queue_id = ${ctx.queue.id} AND status = 'waiting'
    RETURNING id`);
  const id = r.rows[0]?.id;
  if (!id) return null;
  return afterCall(ctx, Number(id), staffId);
}

async function afterCall(ctx: QueueCtx, id: number, staffId: number | null): Promise<QueueTicket> {
  const [t] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, id)).limit(1);
  await event(ctx.queue.id, id, "called", staffId);
  publish(`queue:${ctx.queue.id}`);
  publish(`branch:${ctx.branch.id}`);
  await cancelQueued("ticket", id, ["queue_ahead"]);
  await notifyTicket(ctx, t!, "queue_turn");
  await notifyAhead(ctx).catch((err) => logger.warn({ err: String(err?.message ?? err) }, "ahead notification failed"));
  return t!;
}

/** Tell whoever is now `notifyAhead` places from the front, once. */
export async function notifyAhead(ctx: QueueCtx): Promise<void> {
  const n = ctx.queue.notifyAhead;
  if (n <= 0) return;
  const s = await snapshot(ctx);
  for (const t of s.waiting.slice(0, n + 1)) {
    const ahead = aheadOf(s, t);
    if (ahead > n || t.aheadNotifiedAt || !t.phone) continue;
    // Someone who joined already this close needs no "almost there".
    if (t.etaAtJoinMin != null && t.etaAtJoinMin <= 5) continue;
    await db.update(queueTicketsTable).set({ aheadNotifiedAt: new Date() }).where(eq(queueTicketsTable.id, t.id));
    await notifyTicket(ctx, t, "queue_ahead", { ahead });
  }
}

type Transition = "recall" | "arrived" | "done" | "no_show" | "requeue" | "remove" | "left" | "on_my_way";

export async function transition(ctx: QueueCtx, ticketId: number, action: Transition, staffId: number | null, opts: { finish?: boolean } = {}): Promise<QueueTicket> {
  const [t] = await db.select().from(queueTicketsTable)
    .where(and(eq(queueTicketsTable.id, ticketId), eq(queueTicketsTable.queueId, ctx.queue.id))).limit(1);
  if (!t) throw new QueueError(404, "التذكرة غير موجودة");
  const now = new Date();
  let patch: Partial<QueueTicket> = {};
  let notifyKey: TemplateKey | null = null;
  switch (action) {
    case "recall":
      if (t.status !== "called") throw new QueueError(409, "التذكرة ليست في حالة نداء");
      if (t.recallCount >= 2) throw new QueueError(409, "تم النداء مرتين — اعتبره لم يحضر أو أرجعه للصف");
      patch = { recallCount: t.recallCount + 1, calledAt: now };
      notifyKey = "queue_recall";
      break;
    case "arrived":
      if (t.status !== "called" && t.status !== "waiting") throw new QueueError(409, "لا يمكن تسجيل الحضور لهذه التذكرة");
      patch = opts.finish
        ? { status: "done", servingAt: now, finishedAt: now, calledAt: t.calledAt ?? now }
        : { status: "serving", servingAt: now, calledAt: t.calledAt ?? now };
      break;
    case "done":
      if (!ACTIVE.includes(t.status)) throw new QueueError(409, "التذكرة منتهية");
      patch = { status: "done", finishedAt: now, servingAt: t.servingAt ?? now, calledAt: t.calledAt ?? now };
      break;
    case "no_show":
      if (!ACTIVE.includes(t.status)) throw new QueueError(409, "التذكرة منتهية");
      patch = { status: "no_show", finishedAt: now };
      notifyKey = "queue_no_show";
      break;
    case "requeue":
      if (t.status !== "called" && t.status !== "no_show") throw new QueueError(409, "لا يمكن إرجاع هذه التذكرة");
      // Back in at the front: they were called once already.
      patch = { status: "waiting", calledAt: null, finishedAt: null, priority: t.priority + 1, aheadNotifiedAt: now };
      break;
    case "remove":
      if (!ACTIVE.includes(t.status)) throw new QueueError(409, "التذكرة منتهية");
      patch = { status: "cancelled", finishedAt: now };
      break;
    case "left":
      if (!ACTIVE.includes(t.status)) throw new QueueError(409, "التذكرة منتهية");
      patch = { status: "left", finishedAt: now };
      notifyKey = "queue_left";
      break;
    case "on_my_way":
      if (t.status !== "called" && t.status !== "waiting") throw new QueueError(409, "التذكرة منتهية");
      if (t.onMyWayAt) return t;
      patch = { onMyWayAt: now };
      break;
  }
  const [u] = await db.update(queueTicketsTable).set(patch).where(eq(queueTicketsTable.id, t.id)).returning();
  await event(ctx.queue.id, t.id, action, staffId);
  publish(`queue:${ctx.queue.id}`);
  publish(`branch:${ctx.branch.id}`);

  if (["done", "no_show", "remove", "left"].includes(action)) await cancelQueued("ticket", t.id);
  // A visit is counted once, when the ticket finishes.
  if (u!.phone && (action === "done" || (action === "arrived" && opts.finish))) {
    await touchCustomer(ctx.org.id, u!.phone, { visit: true, branchId: ctx.branch.id });
  }
  if (action === "no_show" && u!.phone) await touchCustomer(ctx.org.id, u!.phone, { noShow: true });
  if (notifyKey) await notifyTicket(ctx, u!, notifyKey);
  if (["remove", "left", "no_show", "done", "arrived"].includes(action)) await notifyAhead(ctx).catch(() => {});
  return u!;
}

/** Add a walk-in from the staff screen. */
export async function walkIn(ctx: QueueCtx, input: { name?: string; partySize?: number; phone?: string | null; note?: string | null }, staffId: number | null) {
  return join(ctx, { ...input, name: input.name || "", source: "staff", staffId, consented: !!input.phone });
}

export async function setQueueState(ctx: QueueCtx, change: "open" | "close" | "pause" | "resume", staffId: number | null): Promise<Queue> {
  const patch = change === "open" ? { isOpen: true, isPaused: false } : change === "close" ? { isOpen: false } : change === "pause" ? { isPaused: true } : { isPaused: false };
  const [q] = await db.update(queuesTable).set(patch).where(eq(queuesTable.id, ctx.queue.id)).returning();
  await event(ctx.queue.id, null, change === "open" ? "opened" : change === "close" ? "closed" : change === "pause" ? "paused" : "resumed", staffId);
  publish(`queue:${ctx.queue.id}`);
  publish(`branch:${ctx.branch.id}`);
  return q!;
}

export async function adjustEta(ctx: QueueCtx, deltaMin: number | null, staffId: number | null): Promise<Queue> {
  const next = deltaMin === null ? 0 : Math.max(-60, Math.min(180, ctx.queue.etaAdjustMin + Math.round(deltaMin)));
  const [q] = await db.update(queuesTable).set({ etaAdjustMin: next }).where(eq(queuesTable.id, ctx.queue.id)).returning();
  await event(ctx.queue.id, null, "eta_adjusted", staffId, String(next));
  publish(`queue:${ctx.queue.id}`);
  return q!;
}

// ── Notifications for a ticket ────────────────────────────────────

export async function notifyTicket(ctx: QueueCtx, t: QueueTicket, key: TemplateKey, opts: { ahead?: number; consented?: boolean } = {}) {
  if (!t.phone) return;
  const s = await snapshot(ctx);
  const ahead = opts.ahead ?? aheadOf(s, t);
  const lang = ctx.org.defaultLang === "en" ? "en" : "ar";
  const link = key === "queue_no_show"
    ? publicUrl(menuPath(ctx.org.slug, ctx.branch.slug))
    : publicUrl(ticketPath(t.token));
  const text = await renderFor(ctx.org.id, key, lang, {
    name: t.customerName ?? "", number: t.displayCode, ahead,
    eta: formatEta(etaAt(s, ahead), lang),
    branch: lang === "en" ? (ctx.branch.nameEn || ctx.branch.name) : ctx.branch.name,
    shop: lang === "en" ? (ctx.org.nameEn || ctx.org.name) : ctx.org.name,
    link,
  });
  await enqueue({
    org: ctx.org, waUserId: ctx.branch.waUserId, phone: t.phone, kind: key, text,
    refType: "ticket", refId: t.id, consented: opts.consented ?? !t.phoneVerified,
  });
}

// ── Housekeeping ──────────────────────────────────────────────────
// Every 30s: called tickets past their grace become no-shows where the queue
// says so; yesterday's still-waiting tickets are closed.

let sweeper: NodeJS.Timeout | null = null;

export async function sweep(now = new Date()): Promise<{ noShows: number; closed: number }> {
  let noShows = 0, closed = 0;
  const auto = await db.select({ t: queueTicketsTable, q: queuesTable }).from(queueTicketsTable)
    .innerJoin(queuesTable, eq(queuesTable.id, queueTicketsTable.queueId))
    .where(and(eq(queueTicketsTable.status, "called"), eq(queuesTable.autoNoShow, true), isNotNull(queueTicketsTable.calledAt)));
  for (const { t, q } of auto) {
    const grace = (q.noShowMin + (t.onMyWayAt ? q.noShowMin : 0)) * 60_000;
    if (now.getTime() - t.calledAt!.getTime() < grace) continue;
    const ctx = await queueCtx(q.id);
    if (!ctx) continue;
    await transition(ctx, t.id, "no_show", null).catch(() => {});
    noShows++;
  }
  // Tickets from an earlier service day that never got called.
  const stale = await db.select({ id: queueTicketsTable.id, queueId: queueTicketsTable.queueId, day: queueTicketsTable.serviceDay, tz: orgsTable.timezone })
    .from(queueTicketsTable).innerJoin(orgsTable, eq(orgsTable.id, queueTicketsTable.orgId))
    .where(inArray(queueTicketsTable.status, ACTIVE)).limit(500);
  const touched = new Set<number>();
  for (const s of stale) {
    if (s.day >= serviceDay(s.tz, now)) continue;
    await db.update(queueTicketsTable).set({ status: "left", finishedAt: now, note: sql`coalesce(${queueTicketsTable.note} || ' · ', '') || 'أُغلق مع نهاية اليوم'` })
      .where(eq(queueTicketsTable.id, s.id));
    touched.add(s.queueId);
    closed++;
  }
  for (const id of touched) publish(`queue:${id}`);
  return { noShows, closed };
}

export function startQueueSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => { sweep().catch((err) => logger.warn({ err: String(err?.message ?? err) }, "queue sweep failed")); }, 30_000);
  sweeper.unref?.();
}

// ── For the staff screen ──────────────────────────────────────────

export function staffTicket(t: QueueTicket, s: Snapshot, now = Date.now()) {
  const ahead = aheadOf(s, t);
  return {
    id: t.id, displayCode: t.displayCode, number: t.number, status: t.status, priority: t.priority,
    customerName: t.customerName, partySize: t.partySize, phone: t.phone, phoneVerified: t.phoneVerified,
    source: t.source, note: t.note, serviceItemId: t.serviceItemId,
    joinedAt: t.joinedAt, calledAt: t.calledAt, servingAt: t.servingAt, onMyWay: !!t.onMyWayAt, recallCount: t.recallCount,
    waitedMin: Math.round(((t.calledAt?.getTime() ?? now) - t.joinedAt.getTime()) / 60_000),
    sinceCalledMin: t.calledAt ? Math.round((now - t.calledAt.getTime()) / 60_000) : null,
    late: t.status === "called" && !!t.calledAt && now - t.calledAt.getTime() > s.queue.noShowMin * 60_000 * (t.onMyWayAt ? 2 : 1),
    ahead, eta: etaAt(s, ahead),
  };
}

export async function staffView(ctx: QueueCtx) {
  const s = await snapshot(ctx);
  const now = Date.now();
  return {
    queue: s.queue, day: s.day,
    interval: s.interval,
    nextEta: etaAt(s, s.waiting.length),
    counts: { waiting: s.waiting.length, called: s.called.length, serving: s.serving.length, served: s.servedToday, noShows: s.noShowsToday },
    avgWaitToday: s.avgWaitToday,
    waiting: s.waiting.map((t) => staffTicket(t, s, now)),
    called: s.called.map((t) => staffTicket(t, s, now)),
    serving: s.serving.map((t) => staffTicket(t, s, now)),
  };
}
