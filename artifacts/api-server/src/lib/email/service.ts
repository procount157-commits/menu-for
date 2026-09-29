// ── Campaigns, the queue, the ladder, and the events ─────────────
// One queue per account: campaigns and sequences both enqueue rows into
// email_messages and a single worker drains them at the account's pace —
// hourly and daily caps, sending hours, a jittered gap, and whatever the
// deliverability verdict says on top. Every send, open, click, reply,
// bounce and unsubscribe is an event row, and the counters on the campaign
// are derived from those rather than trusted.

import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  db, emailSettingsTable, emailContactsTable, emailListsTable, emailListMembersTable,
  emailCampaignsTable, emailSequencesTable, emailSequenceJobsTable, emailMessagesTable,
  emailEventsTable, type EmailSettings, type EmailStep, type EmailContact,
} from "@workspace/db";
import { isWithinSendingHours } from "../sending-hours";
import { logger } from "../logger";
import { notify, esc } from "../telegram";
import { sendEmail, SendError, isConfigured, messageIdFor } from "./provider";
import { newToken, renderEmail, firstName, personalize, unsubscribeUrl } from "./tracking";
import { assessEmail, sendGapMs, type EmailVerdict } from "./health";

const SITE_URL = () => (process.env["SITE_URL"] ?? "").replace(/\/+$/, "");
const SECRET   = () => process.env["SESSION_SECRET"] ?? "wam";

// ── Settings ──────────────────────────────────────────────────────
export async function getSettings(userId: number): Promise<EmailSettings | null> {
  const [s] = await db.select().from(emailSettingsTable).where(eq(emailSettingsTable.userId, userId)).limit(1);
  return s ?? null;
}

// ── Events ────────────────────────────────────────────────────────
export type EventType = "open" | "click" | "reply" | "bounce" | "unsubscribe" | "complaint" | "sent" | "failed";

export async function recordEvent(userId: number, messageId: number | null, type: EventType, extra: { url?: string; meta?: Record<string, unknown> } = {}) {
  await db.insert(emailEventsTable).values({ userId, messageId, type, url: extra.url ?? null, meta: extra.meta ?? {} });
  if (!messageId) return;

  const [m] = await db.select().from(emailMessagesTable).where(eq(emailMessagesTable.id, messageId)).limit(1);
  if (!m) return;
  const now = new Date();
  const counter = { open: "openCount", click: "clickCount", reply: "replyCount", bounce: "bounceCount", unsubscribe: "unsubCount" } as const;

  if (type === "open") {
    await db.update(emailMessagesTable).set({ openedAt: m.openedAt ?? now, openCount: sql`${emailMessagesTable.openCount} + 1` }).where(eq(emailMessagesTable.id, messageId));
    if (m.contactId) await db.update(emailContactsTable).set({ lastOpenedAt: now }).where(eq(emailContactsTable.id, m.contactId));
    if (m.campaignId && !m.openedAt) await db.update(emailCampaignsTable).set({ openCount: sql`${emailCampaignsTable.openCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
    // A sequence that stops on open.
    if (m.sequenceJobId && !m.openedAt) await stopSequenceIf(m.sequenceJobId, "stopOnOpen", "فتح الرسالة");
  } else if (type === "click") {
    await db.update(emailMessagesTable).set({ clickedAt: m.clickedAt ?? now, clickCount: sql`${emailMessagesTable.clickCount} + 1`, openedAt: m.openedAt ?? now }).where(eq(emailMessagesTable.id, messageId));
    if (m.campaignId && !m.clickedAt) await db.update(emailCampaignsTable).set({ clickCount: sql`${emailCampaignsTable.clickCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
  } else if (type === "reply") {
    await db.update(emailMessagesTable).set({ repliedAt: m.repliedAt ?? now }).where(eq(emailMessagesTable.id, messageId));
    if (m.contactId) await db.update(emailContactsTable).set({ lastRepliedAt: now }).where(eq(emailContactsTable.id, m.contactId));
    if (m.campaignId && !m.repliedAt) await db.update(emailCampaignsTable).set({ replyCount: sql`${emailCampaignsTable.replyCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
    if (m.contactId) await cancelSequencesFor(userId, m.contactId, "ردّ على البريد");
  } else if (type === "bounce" || type === "complaint") {
    await db.update(emailMessagesTable).set({ status: "bounced", bouncedAt: now }).where(eq(emailMessagesTable.id, messageId));
    if (m.contactId) {
      await db.update(emailContactsTable).set({ status: type === "bounce" ? "bounced" : "complained" }).where(eq(emailContactsTable.id, m.contactId));
      await cancelSequencesFor(userId, m.contactId, type === "bounce" ? "ارتدّ البريد" : "بلّغ عن إزعاج");
    }
    if (m.campaignId) await db.update(emailCampaignsTable).set({ bounceCount: sql`${emailCampaignsTable.bounceCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
  } else if (type === "unsubscribe") {
    if (m.contactId) {
      await db.update(emailContactsTable).set({ status: "unsubscribed" }).where(eq(emailContactsTable.id, m.contactId));
      await cancelSequencesFor(userId, m.contactId, "ألغى الاشتراك");
    }
    if (m.campaignId) await db.update(emailCampaignsTable).set({ [counter.unsubscribe]: sql`${emailCampaignsTable.unsubCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
  }
}

export async function messageByToken(token: string) {
  const [m] = await db.select().from(emailMessagesTable).where(eq(emailMessagesTable.token, token)).limit(1);
  return m ?? null;
}

// ── Campaigns ─────────────────────────────────────────────────────
/** Queue a campaign: one message per active member of its list. */
export async function startCampaign(userId: number, campaignId: number): Promise<{ queued: number; skipped: number }> {
  const [c] = await db.select().from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.id, campaignId), eq(emailCampaignsTable.userId, userId))).limit(1);
  if (!c) throw new Error("الحملة غير موجودة");
  if (!c.listId) throw new Error("الحملة بلا قائمة");
  const s = await getSettings(userId);
  if (!isConfigured(s)) throw new Error("إعدادات البريد غير مكتملة — اضبط المُرسِل أولاً");

  const members = await db.select({ c: emailContactsTable }).from(emailListMembersTable)
    .innerJoin(emailContactsTable, eq(emailContactsTable.id, emailListMembersTable.contactId))
    .where(eq(emailListMembersTable.listId, c.listId));

  // One message per contact per campaign — a resume must not double up.
  const already = new Set((await db.select({ contactId: emailMessagesTable.contactId }).from(emailMessagesTable)
    .where(eq(emailMessagesTable.campaignId, c.id))).map((r) => r.contactId));

  let queued = 0, skipped = 0;
  const batch: Array<typeof emailMessagesTable.$inferInsert> = [];
  for (const { c: contact } of members) {
    if (contact.status !== "active" || contact.mxOk === false || already.has(contact.id)) { skipped++; continue; }
    batch.push({ userId, campaignId: c.id, contactId: contact.id, toEmail: contact.email, subject: c.subject, token: newToken(), status: "queued" });
    queued++;
  }
  for (let i = 0; i < batch.length; i += 200) await db.insert(emailMessagesTable).values(batch.slice(i, i + 200));

  await db.update(emailCampaignsTable).set({ status: "sending", startedAt: c.startedAt ?? new Date(), pauseReason: null })
    .where(eq(emailCampaignsTable.id, c.id));
  logger.info({ userId, campaignId: c.id, queued, skipped }, "حملة بريد بدأت");
  return { queued, skipped };
}

export async function pauseCampaign(userId: number, campaignId: number, reason: string | null = null) {
  await db.update(emailCampaignsTable).set({ status: "paused", pauseReason: reason })
    .where(and(eq(emailCampaignsTable.id, campaignId), eq(emailCampaignsTable.userId, userId)));
}

// ── Sequences ─────────────────────────────────────────────────────
export async function enrolInSequence(userId: number, sequenceId: number, contactIds: number[]): Promise<{ enrolled: number; skipped: number }> {
  const [seq] = await db.select().from(emailSequencesTable)
    .where(and(eq(emailSequencesTable.id, sequenceId), eq(emailSequencesTable.userId, userId))).limit(1);
  if (!seq) throw new Error("التسلسل غير موجود");
  const steps = (seq.steps as EmailStep[]) ?? [];
  if (!steps.length) throw new Error("التسلسل بلا خطوات");

  const contacts = contactIds.length
    ? await db.select().from(emailContactsTable).where(and(eq(emailContactsTable.userId, userId), inArray(emailContactsTable.id, contactIds)))
    : [];
  const active = await db.select({ contactId: emailSequenceJobsTable.contactId }).from(emailSequenceJobsTable)
    .where(and(eq(emailSequenceJobsTable.userId, userId), eq(emailSequenceJobsTable.sequenceId, sequenceId), eq(emailSequenceJobsTable.status, "pending")));
  const inFlight = new Set(active.map((a) => a.contactId));

  let enrolled = 0, skipped = 0;
  const rows: Array<typeof emailSequenceJobsTable.$inferInsert> = [];
  const base = Date.now();
  // Spread the first rung over an hour so an import of five hundred does not
  // land as one burst; later rungs keep their offsets.
  for (const c of contacts) {
    if (c.status !== "active" || c.mxOk === false || inFlight.has(c.id)) { skipped++; continue; }
    const spread = Math.random() * 60 * 60_000;
    steps.forEach((st, i) => rows.push({
      userId, sequenceId, contactId: c.id, stepIndex: i,
      dueAt: new Date(base + spread + Math.max(0, Number(st.afterHours) || 0) * 3_600_000),
    }));
    enrolled++;
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(emailSequenceJobsTable).values(rows.slice(i, i + 200));
  logger.info({ userId, sequenceId, enrolled, skipped }, "تسجيل في تسلسل بريد");
  return { enrolled, skipped };
}

export async function cancelSequencesFor(userId: number, contactId: number, reason: string): Promise<number> {
  const r = await db.update(emailSequenceJobsTable).set({ status: "cancelled", error: reason })
    .where(and(eq(emailSequenceJobsTable.userId, userId), eq(emailSequenceJobsTable.contactId, contactId), eq(emailSequenceJobsTable.status, "pending")))
    .returning({ id: emailSequenceJobsTable.id });
  return r.length;
}

async function stopSequenceIf(jobId: number, flag: "stopOnOpen" | "stopOnReply", reason: string) {
  const [job] = await db.select().from(emailSequenceJobsTable).where(eq(emailSequenceJobsTable.id, jobId)).limit(1);
  if (!job) return;
  const [seq] = await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.id, job.sequenceId)).limit(1);
  if (seq?.[flag]) await cancelSequencesFor(job.userId, job.contactId, reason);
}

/** Turn due rungs into queued messages. Runs every minute. */
export async function enqueueDueSequenceSteps(now = new Date()): Promise<number> {
  const due = await db.select().from(emailSequenceJobsTable)
    .where(and(eq(emailSequenceJobsTable.status, "pending"), lt(emailSequenceJobsTable.dueAt, now)))
    .orderBy(asc(emailSequenceJobsTable.dueAt)).limit(200);
  let n = 0;
  for (const job of due) {
    const [seq] = await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.id, job.sequenceId)).limit(1);
    const step = ((seq?.steps as EmailStep[]) ?? [])[job.stepIndex];
    const [contact] = await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, job.contactId)).limit(1);
    if (!seq?.isActive || !step || !contact || contact.status !== "active") {
      await db.update(emailSequenceJobsTable).set({ status: "skipped", error: !seq?.isActive ? "التسلسل موقوف" : !step ? "خطوة غير موجودة" : "جهة الاتصال غير نشطة" })
        .where(eq(emailSequenceJobsTable.id, job.id));
      continue;
    }
    // Anything more than a week overdue is not a follow-up any more.
    if (now.getTime() - new Date(job.dueAt).getTime() > 7 * 24 * 3_600_000) {
      await db.update(emailSequenceJobsTable).set({ status: "skipped", error: "تأخر أكثر من أسبوع" }).where(eq(emailSequenceJobsTable.id, job.id));
      continue;
    }
    const [m] = await db.insert(emailMessagesTable).values({
      userId: job.userId, sequenceJobId: job.id, contactId: contact.id, toEmail: contact.email,
      subject: personalize(step.subject, varsFor(contact)), token: newToken(), status: "queued",
    }).returning({ id: emailMessagesTable.id });
    await db.update(emailSequenceJobsTable).set({ status: "sent", messageId: m!.id }).where(eq(emailSequenceJobsTable.id, job.id));
    n++;
  }
  return n;
}

// ── The worker ────────────────────────────────────────────────────
export function varsFor(c: EmailContact | null, s?: EmailSettings | null): Record<string, string | null | undefined> {
  return {
    name: c?.name || c?.company || "", first_name: firstName(c?.name) || c?.company || "",
    company: c?.company ?? "", email: c?.email ?? "", city: c?.city ?? "", industry: c?.industry ?? "",
    sender: s?.fromName ?? "", sender_email: s?.fromEmail ?? "",
  };
}

const lastSentAt = new Map<number, number>();
const heldUntil  = new Map<number, number>();

export async function signals(userId: number) {
  const day = new Date(Date.now() - 24 * 3_600_000);
  const [[row], [first]] = await Promise.all([
    db.select({
      sent:  sql<number>`count(*) filter (where ${emailEventsTable.type} = 'sent')`,
      bounced: sql<number>`count(*) filter (where ${emailEventsTable.type} = 'bounce')`,
      complaints: sql<number>`count(*) filter (where ${emailEventsTable.type} = 'complaint')`,
      unsub: sql<number>`count(*) filter (where ${emailEventsTable.type} = 'unsubscribe')`,
      opened: sql<number>`count(distinct ${emailEventsTable.messageId}) filter (where ${emailEventsTable.type} = 'open')`,
      replied: sql<number>`count(*) filter (where ${emailEventsTable.type} = 'reply')`,
    }).from(emailEventsTable).where(and(eq(emailEventsTable.userId, userId), gte(emailEventsTable.createdAt, day))),
    db.select({ at: emailMessagesTable.sentAt }).from(emailMessagesTable)
      .where(and(eq(emailMessagesTable.userId, userId), eq(emailMessagesTable.status, "sent"))).orderBy(asc(emailMessagesTable.sentAt)).limit(1),
  ]);
  const ageDays = first?.at ? Math.floor((Date.now() - new Date(first.at).getTime()) / 86_400_000) : 0;
  return {
    sent24h: Number(row?.sent ?? 0), bounced24h: Number(row?.bounced ?? 0), complaints24h: Number(row?.complaints ?? 0),
    unsubscribed24h: Number(row?.unsub ?? 0), opened24h: Number(row?.opened ?? 0), replied24h: Number(row?.replied ?? 0),
    senderAgeDays: ageDays,
  };
}

export async function verdictFor(userId: number): Promise<EmailVerdict> {
  return assessEmail(await signals(userId));
}

/** One pass over every account with something queued. Runs every 20 s. */
export async function drainQueues(): Promise<void> {
  if (!isWithinSendingHours()) return;
  const accounts = await db.selectDistinct({ userId: emailMessagesTable.userId }).from(emailMessagesTable)
    .where(eq(emailMessagesTable.status, "queued"));

  for (const { userId } of accounts) {
    try { await drainOne(userId); }
    catch (err) { logger.warn({ userId, err: String((err as any)?.message ?? err) }, "فشل مرور طابور البريد"); }
  }
}

async function drainOne(userId: number) {
  const s = await getSettings(userId);
  if (!isConfigured(s)) return;

  const now = Date.now();
  if ((heldUntil.get(userId) ?? 0) > now) return;

  const v = await verdictFor(userId);
  if (v.holdMinutes > 0) {
    heldUntil.set(userId, now + v.holdMinutes * 60_000);
    await db.update(emailCampaignsTable).set({ status: "paused", pauseReason: v.reasons.join(" ") })
      .where(and(eq(emailCampaignsTable.userId, userId), eq(emailCampaignsTable.status, "sending")));
    await notify(userId, `<b>📧 أوقفنا إرسال البريد ${v.holdMinutes} دقيقة</b>\n${esc(v.reasons.join("\n"))}`).catch(() => {});
    logger.warn({ userId, reasons: v.reasons }, "email sending held");
    return;
  }

  // Pace: the jittered gap for this account, and the caps.
  const gap = sendGapMs(s!.hourlyCap, v.throttle);
  if (now - (lastSentAt.get(userId) ?? 0) < gap) return;

  const hour = new Date(now - 3_600_000), day = new Date(now - 24 * 3_600_000);
  const [[h], [d]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(emailMessagesTable).where(and(eq(emailMessagesTable.userId, userId), eq(emailMessagesTable.status, "sent"), gte(emailMessagesTable.sentAt, hour))),
    db.select({ n: sql<number>`count(*)` }).from(emailMessagesTable).where(and(eq(emailMessagesTable.userId, userId), eq(emailMessagesTable.status, "sent"), gte(emailMessagesTable.sentAt, day))),
  ]);
  if (Number(h?.n) >= s!.hourlyCap || Number(d?.n) >= s!.dailyCap) return;

  // Next in line: campaigns that are sending, and any sequence rung.
  const sending = db.select({ id: emailCampaignsTable.id }).from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.userId, userId), eq(emailCampaignsTable.status, "sending")));
  const [m] = await db.select().from(emailMessagesTable)
    .where(and(eq(emailMessagesTable.userId, userId), eq(emailMessagesTable.status, "queued"),
      sql`(${emailMessagesTable.campaignId} is null or ${emailMessagesTable.campaignId} in (${sending}))`))
    .orderBy(asc(emailMessagesTable.createdAt)).limit(1);
  if (!m) { await completeFinishedCampaigns(userId); return; }

  const [contact] = m.contactId ? await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, m.contactId)).limit(1) : [null];
  if (contact && contact.status !== "active") {
    await db.update(emailMessagesTable).set({ status: "failed", error: `جهة الاتصال ${contact.status}` }).where(eq(emailMessagesTable.id, m.id));
    return;
  }

  // The body: a campaign's html, or the rung's.
  let html = "";
  if (m.campaignId) {
    const [c] = await db.select({ html: emailCampaignsTable.html }).from(emailCampaignsTable).where(eq(emailCampaignsTable.id, m.campaignId)).limit(1);
    html = c?.html ?? "";
  } else if (m.sequenceJobId) {
    const [job] = await db.select().from(emailSequenceJobsTable).where(eq(emailSequenceJobsTable.id, m.sequenceJobId)).limit(1);
    const [seq] = job ? await db.select().from(emailSequencesTable).where(eq(emailSequencesTable.id, job.sequenceId)).limit(1) : [null];
    html = ((seq?.steps as EmailStep[]) ?? [])[job?.stepIndex ?? 0]?.html ?? "";
  }
  if (!html) {
    await db.update(emailMessagesTable).set({ status: "failed", error: "بلا محتوى" }).where(eq(emailMessagesTable.id, m.id));
    return;
  }

  const vars = varsFor(contact, s);
  const base = SITE_URL();
  const rendered = renderEmail(html + (s!.signature ? `<div style="margin-top:20px">${s!.signature}</div>` : ""), vars,
    { base, token: m.token, secret: SECRET(), pixel: !!s!.tracking, links: !!s!.tracking },
    { base, token: m.token, fromName: s!.fromName ?? s!.fromEmail!, fromEmail: s!.fromEmail! });
  const subject = personalize(m.subject, vars);
  const messageId = messageIdFor(m.token, s!.fromEmail!);

  lastSentAt.set(userId, now);
  try {
    const r = await sendEmail(s!, { to: m.toEmail, toName: contact?.name, subject, html: rendered.html, text: rendered.text, messageId, unsubscribeUrl: unsubscribeUrl(base, m.token) });
    await db.update(emailMessagesTable).set({ status: "sent", sentAt: new Date(), providerId: r.providerId, messageIdHdr: messageId, subject }).where(eq(emailMessagesTable.id, m.id));
    if (contact) await db.update(emailContactsTable).set({ lastSentAt: new Date() }).where(eq(emailContactsTable.id, contact.id));
    if (m.campaignId) await db.update(emailCampaignsTable).set({ sentCount: sql`${emailCampaignsTable.sentCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
    await recordEvent(userId, m.id, "sent");
  } catch (err) {
    const e = err as SendError;
    await db.update(emailMessagesTable).set({ status: "failed", error: String(e?.message ?? err).slice(0, 400) }).where(eq(emailMessagesTable.id, m.id));
    if (m.campaignId) await db.update(emailCampaignsTable).set({ failedCount: sql`${emailCampaignsTable.failedCount} + 1` }).where(eq(emailCampaignsTable.id, m.campaignId));
    await recordEvent(userId, m.id, "failed", { meta: { error: String(e?.message ?? err).slice(0, 200) } });
    // A permanent refusal of the address is a bounce in all but name.
    if (e?.permanent && contact) await recordEvent(userId, m.id, "bounce", { meta: { synthetic: true } });
    // The provider itself refusing us (auth, rate) — stop hammering.
    if (!e?.permanent) heldUntil.set(userId, now + 10 * 60_000);
    logger.warn({ userId, messageId: m.id, err: String(e?.message ?? err) }, "email send failed");
  }
}

async function completeFinishedCampaigns(userId: number) {
  const sending = await db.select({ id: emailCampaignsTable.id }).from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.userId, userId), eq(emailCampaignsTable.status, "sending")));
  for (const c of sending) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(emailMessagesTable)
      .where(and(eq(emailMessagesTable.campaignId, c.id), eq(emailMessagesTable.status, "queued")));
    if (Number(n) === 0) {
      await db.update(emailCampaignsTable).set({ status: "completed", completedAt: new Date() }).where(eq(emailCampaignsTable.id, c.id));
      logger.info({ userId, campaignId: c.id }, "حملة بريد اكتملت");
    }
  }
}

/** Scheduled campaigns whose time has come. */
export async function startScheduled(now = new Date()) {
  const due = await db.select().from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.status, "scheduled"), lt(emailCampaignsTable.scheduledAt, now)));
  for (const c of due) await startCampaign(c.userId, c.id).catch((err) =>
    logger.warn({ campaignId: c.id, err: String(err?.message ?? err) }, "تعذّر بدء حملة مجدولة"));
}

// ── Dashboard ─────────────────────────────────────────────────────
export async function overview(userId: number) {
  const day = new Date(Date.now() - 24 * 3_600_000), week = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [[totals], [c], [w], recent, [queued], [lists], [seq], v, s] = await Promise.all([
    db.select({
      contacts: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${emailContactsTable.status} = 'active')`,
      unsub: sql<number>`count(*) filter (where ${emailContactsTable.status} = 'unsubscribed')`,
      bounced: sql<number>`count(*) filter (where ${emailContactsTable.status} in ('bounced','complained'))`,
    }).from(emailContactsTable).where(eq(emailContactsTable.userId, userId)),
    db.select({
      sent: sql<number>`count(*) filter (where ${emailMessagesTable.status} in ('sent','bounced'))`,
      opened: sql<number>`count(*) filter (where ${emailMessagesTable.openedAt} is not null)`,
      clicked: sql<number>`count(*) filter (where ${emailMessagesTable.clickedAt} is not null)`,
      replied: sql<number>`count(*) filter (where ${emailMessagesTable.repliedAt} is not null)`,
      bounced: sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'bounced')`,
      failed: sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'failed')`,
    }).from(emailMessagesTable).where(and(eq(emailMessagesTable.userId, userId), gte(emailMessagesTable.createdAt, day))),
    db.select({
      sent: sql<number>`count(*) filter (where ${emailMessagesTable.status} in ('sent','bounced'))`,
      opened: sql<number>`count(*) filter (where ${emailMessagesTable.openedAt} is not null)`,
      clicked: sql<number>`count(*) filter (where ${emailMessagesTable.clickedAt} is not null)`,
      replied: sql<number>`count(*) filter (where ${emailMessagesTable.repliedAt} is not null)`,
      bounced: sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'bounced')`,
    }).from(emailMessagesTable).where(and(eq(emailMessagesTable.userId, userId), gte(emailMessagesTable.createdAt, week))),
    db.select({ e: emailEventsTable, to: emailMessagesTable.toEmail, subject: emailMessagesTable.subject })
      .from(emailEventsTable).leftJoin(emailMessagesTable, eq(emailMessagesTable.id, emailEventsTable.messageId))
      .where(eq(emailEventsTable.userId, userId)).orderBy(desc(emailEventsTable.createdAt)).limit(40),
    db.select({ n: sql<number>`count(*)` }).from(emailMessagesTable).where(and(eq(emailMessagesTable.userId, userId), eq(emailMessagesTable.status, "queued"))),
    db.select({ n: sql<number>`count(*)` }).from(emailListsTable).where(eq(emailListsTable.userId, userId)),
    db.select({ n: sql<number>`count(*)` }).from(emailSequenceJobsTable).where(and(eq(emailSequenceJobsTable.userId, userId), eq(emailSequenceJobsTable.status, "pending"))),
    verdictFor(userId),
    getSettings(userId),
  ]);
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
  return {
    configured: isConfigured(s),
    sender: s ? { provider: s.provider, fromName: s.fromName, fromEmail: s.fromEmail, hourlyCap: s.hourlyCap, dailyCap: s.dailyCap, tracking: s.tracking, imap: !!s.imapHost } : null,
    trackingBase: SITE_URL() || null,
    contacts: { total: Number(totals?.contacts ?? 0), active: Number(totals?.active ?? 0), unsubscribed: Number(totals?.unsub ?? 0), bounced: Number(totals?.bounced ?? 0), lists: Number(lists?.n ?? 0) },
    today: { sent: Number(c?.sent ?? 0), opened: Number(c?.opened ?? 0), clicked: Number(c?.clicked ?? 0), replied: Number(c?.replied ?? 0), bounced: Number(c?.bounced ?? 0), failed: Number(c?.failed ?? 0),
      openRate: rate(Number(c?.opened ?? 0), Number(c?.sent ?? 0)), replyRate: rate(Number(c?.replied ?? 0), Number(c?.sent ?? 0)) },
    week: { sent: Number(w?.sent ?? 0), opened: Number(w?.opened ?? 0), clicked: Number(w?.clicked ?? 0), replied: Number(w?.replied ?? 0), bounced: Number(w?.bounced ?? 0),
      openRate: rate(Number(w?.opened ?? 0), Number(w?.sent ?? 0)), clickRate: rate(Number(w?.clicked ?? 0), Number(w?.sent ?? 0)), replyRate: rate(Number(w?.replied ?? 0), Number(w?.sent ?? 0)), bounceRate: rate(Number(w?.bounced ?? 0), Number(w?.sent ?? 0)) },
    queue: { queued: Number(queued?.n ?? 0), pendingRungs: Number(seq?.n ?? 0), heldUntil: heldUntil.get(userId) && heldUntil.get(userId)! > Date.now() ? new Date(heldUntil.get(userId)!) : null },
    health: v,
    events: recent.map((r: any) => ({ id: r.e.id, type: r.e.type, at: r.e.createdAt, to: r.to, subject: r.subject, url: r.e.url, meta: r.e.meta })),
  };
}

export function startEmailWorkers(): void {
  setTimeout(() => {
    setInterval(() => void drainQueues().catch((e) => logger.warn({ err: String(e?.message ?? e) }, "email drain failed")), 20_000);
    setInterval(() => void enqueueDueSequenceSteps().catch(() => {}), 60_000);
    setInterval(() => void startScheduled().catch(() => {}), 60_000);
  }, 40_000);
  logger.info("عامل البريد بدأ");
}
