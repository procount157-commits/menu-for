// ── The transactional lane ────────────────────────────────────────
// Flow Hub's sending safety is built for campaigns: a 09:00–21:00 window, a
// ~19s gap, a warm-up ramp that starts at fifty a day. "It's your turn" can
// live with none of that — a restaurant serves at 11pm, and a turn does not
// wait nineteen seconds behind a queue of other turns.
//
// So notifications go out through their own outbox, under rules of their own:
//
//   who      replied   — the customer wrote to this number in the last 24h
//                        (they opened the thread with the prefilled message);
//                        the notification is a reply in their own chat.
//            consented — a number they typed themselves into our form and
//                        agreed to be told on. Smaller cap, counted apart.
//            anything else is not sent: a stranger is a campaign, not a
//            notification.
//   when     as the event happens, at whatever hour the shop is serving —
//            not the campaign window. What is scheduled ahead (a review
//            request, a win-back) is placed between 10:00 and 22:00 local.
//   pace     1.5–4s between messages from one number
//   expiry   each kind has a shelf life: a "your turn" two minutes late is
//            wrong, so it is dropped rather than sent late
//   never    to a number that asked to stop, or while WhatsApp is down —
//            those are recorded as skipped, and the ticket page carries on.

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, notificationsTable, unsubscribedPhonesTable, orgsTable, type Org } from "@workspace/db";
import { getStatus, sendMessage } from "../whatsapp";
import { logger } from "../logger";
import { lastInboundAt } from "../customers";
import { menuPlan } from "../plans";
import type { TemplateKey } from "./templates";

export const REPLIED_WINDOW_MS = 24 * 3_600_000;
/** Per number per day. Replies in a customer's own thread are the safe kind; still bounded. */
export const REPLIED_DAILY_CAP = Number(process.env["NOTIFY_REPLIED_DAILY_CAP"] ?? 800);
/** Per number per day for typed-in numbers. Deliberately small until a week of risk scores says otherwise. */
export const CONSENTED_DAILY_CAP = Number(process.env["NOTIFY_CONSENTED_DAILY_CAP"] ?? 60);

/** How long a notification is still worth sending, by kind. */
const SHELF_MS: Partial<Record<TemplateKey, number>> = {
  queue_turn: 2 * 60_000,
  queue_recall: 2 * 60_000,
  queue_ahead: 5 * 60_000,
  queue_joined: 10 * 60_000,
  status_reply: 2 * 60_000,
  queue_left: 10 * 60_000,
  queue_no_show: 15 * 60_000,
  order_received: 15 * 60_000,
  order_preparing: 10 * 60_000,
  order_ready: 15 * 60_000,
  order_cancelled: 60 * 60_000,
  booking_confirmed: 60 * 60_000,
  booking_cancelled: 60 * 60_000,
  booking_reminder: 60 * 60_000,
  review_request: 6 * 3_600_000,
  winback: 24 * 3_600_000,
};

export interface Enqueue {
  org: Pick<Org, "id" | "ownerUserId">;
  waUserId: number;
  phone: string | null | undefined;
  kind: TemplateKey;
  text: string | null;
  refType?: "ticket" | "order" | "booking" | "customer";
  refId?: number;
  /** The customer typed this number and agreed to messages on it. */
  consented?: boolean;
  /** Not before. */
  at?: Date;
}

export type Lane = "replied" | "consented" | null;

/** Which lane a message may travel in. Pure. */
export function laneFor(lastInbound: Date | null, consented: boolean, now = Date.now()): Lane {
  if (lastInbound && now - lastInbound.getTime() < REPLIED_WINDOW_MS) return "replied";
  if (consented) return "consented";
  return null;
}

export async function enqueue(e: Enqueue): Promise<number | null> {
  if (!e.phone || !e.text) return null;
  const plan = await menuPlan(e.org.ownerUserId);
  const at = e.at ?? new Date();
  const expiresAt = SHELF_MS[e.kind] ? new Date(at.getTime() + SHELF_MS[e.kind]!) : null;
  const lane = laneFor(await lastInboundAt(e.org.id, e.phone), !!e.consented, at.getTime());
  const skip = !plan.features.notify ? "plan" : lane === null ? "no_thread" : null;
  const [row] = await db.insert(notificationsTable).values({
    orgId: e.org.id, waUserId: e.waUserId, phone: e.phone, kind: e.kind,
    refType: e.refType ?? null, refId: e.refId ?? null, text: e.text,
    class: lane ?? (e.consented ? "consented" : "replied"),
    status: skip ? "skipped" : "queued", reason: skip,
    scheduledAt: at, expiresAt,
  }).returning({ id: notificationsTable.id });
  if (!skip) kick();
  return row?.id ?? null;
}

/** Cancel what is still queued for a ticket, order or booking (it was cancelled or served). */
export async function cancelQueued(refType: string, refId: number, kinds?: TemplateKey[]) {
  await db.update(notificationsTable).set({ status: "skipped", reason: "superseded" })
    .where(and(
      eq(notificationsTable.refType, refType), eq(notificationsTable.refId, refId), eq(notificationsTable.status, "queued"),
      ...(kinds?.length ? [inArray(notificationsTable.kind, kinds)] : []),
    ));
}

// ── The worker ────────────────────────────────────────────────────

const nextAt = new Map<number, number>();
const gapMs = () => 1_500 + Math.floor(Math.random() * 2_500);
let timer: NodeJS.Timeout | null = null;
let busy = false;
let kicked = false;

export function kick() { kicked = true; }

async function sentToday(waUserId: number, lane: "replied" | "consented"): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.waUserId, waUserId), eq(notificationsTable.class, lane), eq(notificationsTable.status, "sent"), gte(notificationsTable.sentAt, since)));
  return n;
}

async function mark(id: number, status: "sent" | "failed" | "skipped", reason: string | null, waMessageId?: string) {
  await db.update(notificationsTable).set({ status, reason, sentAt: status === "sent" ? new Date() : null, waMessageId: waMessageId ?? null })
    .where(eq(notificationsTable.id, id));
}

export async function drain(now = new Date()): Promise<number> {
  const due = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.status, "queued"), lte(notificationsTable.scheduledAt, now)))
    .orderBy(notificationsTable.scheduledAt, notificationsTable.id).limit(100);
  let sent = 0;
  for (const n of due) {
    if (n.expiresAt && n.expiresAt < now) { await mark(n.id, "skipped", "expired"); continue; }
    const wait = nextAt.get(n.waUserId) ?? 0;
    if (Date.now() < wait) continue;

    const status = getStatus(n.waUserId) as { connected?: boolean };
    if (!status?.connected) {
      // A turn cannot wait for a reconnect; a booking confirmation can.
      if (n.expiresAt && n.expiresAt.getTime() - now.getTime() < 30 * 60_000) await mark(n.id, "skipped", "wa_disconnected");
      continue;
    }
    const [stop] = await db.select({ id: unsubscribedPhonesTable.id }).from(unsubscribedPhonesTable)
      .where(and(eq(unsubscribedPhonesTable.userId, n.waUserId), eq(unsubscribedPhonesTable.phone, n.phone))).limit(1);
    if (stop) { await mark(n.id, "skipped", "opted_out"); continue; }

    // The lane is decided again now: a typed-in number becomes a reply the
    // moment the customer writes to us.
    const lane = laneFor(await lastInboundAt(n.orgId, n.phone), n.class === "consented");
    if (!lane) { await mark(n.id, "skipped", "no_thread"); continue; }
    const cap = lane === "replied" ? REPLIED_DAILY_CAP : CONSENTED_DAILY_CAP;
    if (await sentToday(n.waUserId, lane) >= cap) { await mark(n.id, "skipped", "daily_cap"); continue; }
    if (lane !== n.class) await db.update(notificationsTable).set({ class: lane }).where(eq(notificationsTable.id, n.id));

    nextAt.set(n.waUserId, Date.now() + gapMs());
    try {
      const id = await sendMessage(n.waUserId, n.phone, n.text);
      await mark(n.id, "sent", null, id ?? undefined);
      sent++;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 300);
      logger.warn({ id: n.id, kind: n.kind, err: msg }, "notification send failed");
      await mark(n.id, "failed", msg);
    }
  }
  return sent;
}

export function startNotifyWorker() {
  if (timer) return;
  let last = 0;
  timer = setInterval(() => {
    if (busy) return;
    if (!kicked && Date.now() - last < 5_000) return;
    kicked = false; busy = true; last = Date.now();
    drain().catch((err) => logger.error({ err: String(err?.message ?? err) }, "notify worker tick failed"))
      .finally(() => { busy = false; });
  }, 500);
  timer.unref?.();
  logger.info("notify worker started");
}

export async function recentNotifications(orgId: number, limit = 100) {
  return db.select().from(notificationsTable).where(eq(notificationsTable.orgId, orgId))
    .orderBy(sql`${notificationsTable.id} desc`).limit(limit);
}

export async function notifyStats(orgId: number) {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.select({ status: notificationsTable.status, reason: notificationsTable.reason, n: sql<number>`count(*)::int` })
    .from(notificationsTable).where(and(eq(notificationsTable.orgId, orgId), gte(notificationsTable.createdAt, since)))
    .groupBy(notificationsTable.status, notificationsTable.reason);
  return rows;
}

export async function orgById(id: number) {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, id)).limit(1);
  return o ?? null;
}
