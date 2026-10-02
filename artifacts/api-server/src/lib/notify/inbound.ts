// ── A customer wrote to the shop's WhatsApp ───────────────────────
// Rules, not a model — the same choice Flow Hub made for intents, for the
// same reasons: microseconds, no key, no invention.
//
//   1. a code («رمز 7F3K», «#7F3K») that belongs to a live ticket, order or
//      booking of this number's org → link the sender's number to it and
//      answer with the confirmation
//   2. no code, but the sender holds a live ticket → «كم قدامي» / «إلغاء الدور»
//   3. a 1–5 after a review request → the rating
//   4. «المنيو» / «حجز» → the link
//   5. anything else → not ours; the agent answers as before
//
// Every message from a known org also stamps `customers.last_inbound_at`,
// which is what lets later notifications travel as replies.

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db, branchesTable, orgsTable, queueTicketsTable, ordersTable, bookingsTable, customersTable,
  type Org, type Branch,
} from "@workspace/db";
import { extractCode, queueCommand, normaliseDigits, formatEta } from "@workspace/menu-shared";
import { registerInboundHook, registerOnConnectHook, getStatus } from "../whatsapp";
import { claimInbound } from "../inbound-claims";
import { touchCustomer } from "../customers";
import { ACTIVE, queueCtx, notifyTicket, transition, snapshot, aheadOf, etaAt, todayFor } from "../queue/engine";
import { confirmOrderFromWhatsApp } from "../orders/service";
import { confirmBookingFromWhatsApp } from "../booking/service";
import { enqueue } from "./outbox";
import { renderFor } from "./templates";
import { publish } from "../realtime";
import { publicUrl, ticketPath, menuPath } from "../menu/urls";
import { logger } from "../logger";

async function orgOfWaUser(waUserId: number): Promise<{ org: Org; branches: Branch[] } | null> {
  const rows = await db.select({ b: branchesTable, o: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId))
    .where(eq(branchesTable.waUserId, waUserId));
  if (!rows.length) return null;
  return { org: rows[0]!.o, branches: rows.map((r) => r.b) };
}

async function reply(org: Org, waUserId: number, phone: string, text: string | null, kind: "status_reply" | "queue_joined" = "status_reply") {
  await enqueue({ org, waUserId, phone, kind, text });
}

/** Returns whether the message was ours. */
export async function handleCustomerMessage(waUserId: number, phone: string, text: string): Promise<boolean> {
  const scope = await orgOfWaUser(waUserId);
  if (!scope) return false;
  const { org, branches } = scope;
  const branchIds = branches.map((b) => b.id);
  const lang = org.defaultLang === "en" ? "en" : "ar";
  await touchCustomer(org.id, phone, { inbound: true });

  // ── 1. A code ───────────────────────────────────────────────────
  const code = extractCode(text);
  if (code) {
    const day = todayFor(org);
    const [t] = await db.select().from(queueTicketsTable).where(and(
      eq(queueTicketsTable.orgId, org.id), inArray(queueTicketsTable.branchId, branchIds),
      eq(queueTicketsTable.joinCode, code), eq(queueTicketsTable.serviceDay, day), inArray(queueTicketsTable.status, ACTIVE),
    )).limit(1);
    if (t) {
      const first = !t.phoneVerified;
      const [u] = await db.update(queueTicketsTable).set({ phone, phoneVerified: true }).where(eq(queueTicketsTable.id, t.id)).returning();
      await touchCustomer(org.id, phone, { name: t.customerName, optIn: t.marketingOptIn, branchId: t.branchId });
      const ctx = await queueCtx(t.queueId);
      if (ctx) {
        publish(`queue:${t.queueId}`);
        // Told once; a second copy of the same message gets the position.
        await notifyTicket(ctx, u!, first ? (u!.status === "called" ? "queue_turn" : "queue_joined") : "status_reply");
      }
      return true;
    }
    const since = new Date(Date.now() - 3 * 24 * 3_600_000);
    const [o] = await db.select().from(ordersTable).where(and(
      eq(ordersTable.orgId, org.id), inArray(ordersTable.branchId, branchIds), eq(ordersTable.code, code),
      gte(ordersTable.createdAt, since), inArray(ordersTable.status, ["pending", "received", "preparing", "ready"]),
    )).limit(1);
    if (o) { await confirmOrderFromWhatsApp(o, phone); return true; }
    const [b] = await db.select().from(bookingsTable).where(and(
      eq(bookingsTable.orgId, org.id), inArray(bookingsTable.branchId, branchIds), eq(bookingsTable.code, code),
      gte(bookingsTable.endsAt, new Date()), inArray(bookingsTable.status, ["pending", "confirmed"]),
    )).limit(1);
    if (b) { await confirmBookingFromWhatsApp(b, phone); return true; }
    // A code that matches nothing live: fall through, the agent may help.
  }

  // ── 2. A command from someone holding a ticket ──────────────────
  const cmd = queueCommand(text);
  const [held] = await db.select().from(queueTicketsTable).where(and(
    eq(queueTicketsTable.orgId, org.id), eq(queueTicketsTable.phone, phone), inArray(queueTicketsTable.status, ACTIVE),
  )).orderBy(desc(queueTicketsTable.joinedAt)).limit(1);
  if (held && (cmd === "status" || cmd === "leave")) {
    const ctx = await queueCtx(held.queueId);
    if (!ctx) return false;
    if (cmd === "leave") { await transition(ctx, held.id, "left", null); return true; }
    const s = await snapshot(ctx);
    const ahead = aheadOf(s, held);
    const msg = await renderFor(org.id, "status_reply", lang, {
      name: held.customerName ?? "", number: held.displayCode, ahead,
      eta: held.status === "waiting" ? formatEta(etaAt(s, ahead), lang) : (lang === "ar" ? "جاء دورك" : "it's your turn"),
      link: publicUrl(ticketPath(held.token)),
    });
    await reply(org, waUserId, phone, msg);
    return true;
  }

  // ── 3. A rating after a review request ─────────────────────────
  const digit = normaliseDigits(text).trim().match(/^([1-5])(\s*(\/\s*5|⭐+|نجوم?|stars?))?$/i);
  if (digit) {
    const [c] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone))).limit(1);
    if (c?.reviewAskedAt && Date.now() - c.reviewAskedAt.getTime() < 3 * 24 * 3_600_000) {
      const rating = Number(digit[1]);
      await touchCustomer(org.id, phone, { rating });
      await db.update(customersTable).set({ reviewAskedAt: null }).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone)));
      const thanks = rating >= 4
        ? (lang === "ar" ? "شكراً على تقييمك 🙏 يسعدنا نشوفك مرة ثانية." : "Thank you 🙏 We'd love to see you again.")
        : (lang === "ar" ? "شكراً على صراحتك 🙏 وصلت ملاحظتك لصاحب المحل، وإذا حاب تخبرنا أكثر اكتب لنا هنا." : "Thank you for telling us 🙏 The owner has your note — reply here if you'd like to tell us more.");
      await reply(org, waUserId, phone, thanks);
      if (rating <= 3) {
        const { notify } = await import("../telegram");
        void notify(org.ownerUserId, `⚠️ تقييم ${rating}/5 من ${phone} — ${org.name}`).catch(() => {});
        const { alertShop } = await import("./alerts");
        const b = branches.find((x) => x.isActive) ?? branches[0]!;
        await alertShop(org, b, "alert_rating", `⚠️ تقييم ${rating}/5 من زبون (${phone}) — تواصل معه قبل ما يكتبها في مكان ثاني.`, { type: "customer" });
      }
      return true;
    }
  }

  // ── 4. Menu / booking link ─────────────────────────────────────
  if (cmd === "menu" || cmd === "book") {
    const branch = branches.find((b) => b.isActive) ?? branches[0]!;
    const link = publicUrl(menuPath(org.slug, branch.slug) + (cmd === "book" ? "?book=1" : ""));
    await reply(org, waUserId, phone, lang === "ar"
      ? `${cmd === "menu" ? "المنيو" : "الحجز"} من هنا 👇\n${link}`
      : `${cmd === "menu" ? "Our menu" : "Book here"} 👇\n${link}`);
    return true;
  }
  return false;
}

/** Messages that look like ours are claimed at once, so the agent waits for the verdict. */
const looksOurs = (text: string) =>
  !!extractCode(text) || queueCommand(text) !== null || /^\s*[1-5١-٥]\s*(\/\s*5|⭐+|نجوم?|stars?)?\s*$/i.test(text);

let started = false;

export function startMenuInbound() {
  if (started) return;
  started = true;
  registerInboundHook((ev) => {
    if (!ev.text) return;
    const run = handleCustomerMessage(ev.userId, ev.phone, ev.text).catch((err) => {
      logger.warn({ err: String(err?.message ?? err), userId: ev.userId }, "menu inbound failed");
      return false;
    });
    if (looksOurs(ev.text)) claimInbound(ev.userId, ev.phone, ev.text, run);
  });
  // Keep the number customers write to in step with the linked WhatsApp.
  registerOnConnectHook((userId) => {
    const s = getStatus(userId) as { phone?: string | null };
    const phone = String(s?.phone ?? "").replace(/\D/g, "");
    if (phone.length >= 8) {
      void db.update(branchesTable).set({ waPhone: phone }).where(eq(branchesTable.waUserId, userId)).catch(() => {});
    }
  });
  logger.info("menu inbound hook registered");
}
