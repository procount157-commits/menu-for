// ── Who a campaign may reach ──────────────────────────────────────
// A shop's customers come from the queue, orders and bookings. Every
// marketing audience is drawn from those who ticked «أرسلوا لي العروض» —
// that is the one rule here — and then narrowed: regulars, people who
// stopped coming (retargeting), newcomers.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db, customersTable, contactGroupsTable, contactsTable, unsubscribedPhonesTable, messageLogs, campaignsTable,
  incomingMessagesTable, type Org,
} from "@workspace/db";
import { saveToGroup, saveToNewGroup } from "../contact-save";

export const SEGMENTS = {
  opted_in: { ar: "كل من وافق على العروض", en: "Everyone who opted in" },
  regulars: { ar: "الزبائن الدائمون (3 زيارات أو طلبات فأكثر)", en: "Regulars" },
  inactive: { ar: "غابوا 30 يوماً أو أكثر", en: "Not seen for 30 days" },
  new:      { ar: "جدد هذا الشهر", en: "New this month" },
} as const;
export type Segment = keyof typeof SEGMENTS;
export const isSegment = (s: unknown): s is Segment => typeof s === "string" && s in SEGMENTS;

const DAY = 24 * 3_600_000;

function where(orgId: number, segment: Segment, now = new Date()) {
  const base = [eq(customersTable.orgId, orgId), eq(customersTable.marketingOptIn, true), sql`${customersTable.phone} !~ '@'`];
  if (segment === "regulars") base.push(sql`${customersTable.visits} + ${customersTable.ordersCount} >= 3`);
  if (segment === "inactive") base.push(lt(customersTable.lastSeenAt, new Date(now.getTime() - 30 * DAY)));
  if (segment === "new") base.push(gte(customersTable.firstSeenAt, new Date(now.getTime() - 30 * DAY)));
  return and(...base);
}

export async function segmentCounts(orgId: number): Promise<Record<Segment, number>> {
  const out = {} as Record<Segment, number>;
  for (const s of Object.keys(SEGMENTS) as Segment[]) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(customersTable).where(where(orgId, s));
    out[s] = n;
  }
  return out;
}

export interface AudienceOpts {
  /** Leave out anyone a campaign reached within this many days. */
  restDays?: number;
  max?: number;
}

/** The people a campaign to `segment` would reach from this number, today. */
export async function audience(org: Pick<Org, "id">, waUserId: number, segment: Segment, opts: AudienceOpts = {}): Promise<Array<{ phone: string; name: string | null }>> {
  const rows = await db.select({ phone: customersTable.phone, name: customersTable.name }).from(customersTable)
    .where(where(org.id, segment)).orderBy(sql`${customersTable.lastSeenAt} desc`).limit(5_000);
  if (!rows.length) return [];
  const phones = rows.map((r) => r.phone);
  const stopped = new Set((await db.select({ phone: unsubscribedPhonesTable.phone }).from(unsubscribedPhonesTable)
    .where(and(eq(unsubscribedPhonesTable.userId, waUserId), inArray(unsubscribedPhonesTable.phone, phones)))).map((r) => r.phone));
  let recent = new Set<string>();
  if (opts.restDays && opts.restDays > 0) {
    const since = new Date(Date.now() - opts.restDays * DAY);
    recent = new Set((await db.select({ phone: messageLogs.phone }).from(messageLogs)
      .innerJoin(campaignsTable, eq(campaignsTable.id, messageLogs.campaignId))
      .where(and(eq(campaignsTable.userId, waUserId), eq(messageLogs.status, "sent"), gte(messageLogs.sentAt, since), inArray(messageLogs.phone, phones)))).map((r) => r.phone));
  }
  const out = rows.filter((r) => !stopped.has(r.phone) && !recent.has(r.phone));
  return opts.max ? out.slice(0, opts.max) : out;
}

/** Put people in a contact list of the number's account: one list per name, topped up. */
export async function toList(waUserId: number, name: string, description: string, entries: Array<{ phone: string; name: string | null }>, opts: { fresh?: boolean } = {}) {
  const [existing] = opts.fresh ? [] : await db.select().from(contactGroupsTable).where(and(eq(contactGroupsTable.userId, waUserId), eq(contactGroupsTable.name, name))).limit(1);
  if (existing) {
    const r = await saveToGroup(waUserId, existing.id, entries, { allowOtherLists: true });
    return { groupId: existing.id, added: r.added };
  }
  const r = await saveToNewGroup(waUserId, name, description, entries, { allowOtherLists: true });
  const [g] = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(and(eq(contactGroupsTable.userId, waUserId), eq(contactGroupsTable.name, name))).limit(1);
  return { groupId: g?.id ?? null, added: r.added };
}

// ── Retargeting from a campaign's own results ─────────────────────

export const RETARGETS = {
  unread:        { ar: "وصلتهم ولم يفتحوها", en: "Delivered, not opened" },
  read_no_reply: { ar: "فتحوها ولم يردّوا", en: "Opened, no reply" },
  undelivered:   { ar: "لم تصلهم", en: "Not delivered" },
} as const;
export type Retarget = keyof typeof RETARGETS;
export const isRetarget = (s: unknown): s is Retarget => typeof s === "string" && s in RETARGETS;

export async function retargetPhones(waUserId: number, campaignId: number, who: Retarget): Promise<Array<{ phone: string; name: string | null }> | null> {
  const [c] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, waUserId))).limit(1);
  if (!c) return null;
  const logs = await db.select().from(messageLogs).where(and(eq(messageLogs.campaignId, campaignId), eq(messageLogs.status, "sent")));
  let picked = logs.filter((l) =>
    who === "unread" ? !!l.deliveredAt && !l.readAt
    : who === "read_no_reply" ? !!l.readAt
    : !l.deliveredAt && !l.readAt);
  if (who === "read_no_reply" && picked.length) {
    // Anyone who wrote to the number after the message went out has replied.
    const first = picked.reduce((m, l) => (l.sentAt && l.sentAt < m ? l.sentAt : m), new Date());
    const replied = new Set((await db.select({ phone: incomingMessagesTable.phone, at: incomingMessagesTable.receivedAt }).from(incomingMessagesTable)
      .where(and(eq(incomingMessagesTable.userId, waUserId), gte(incomingMessagesTable.receivedAt, first), inArray(incomingMessagesTable.phone, picked.map((l) => l.phone)))))
      .map((r) => r.phone));
    picked = picked.filter((l) => !replied.has(l.phone));
  }
  if (!picked.length) return [];
  const names = c.contactGroupId
    ? new Map((await db.select({ phone: contactsTable.phone, name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.groupId, c.contactGroupId))).map((r) => [r.phone, r.name]))
    : new Map<string, string | null>();
  const seen = new Set<string>();
  return picked.filter((l) => !seen.has(l.phone) && seen.add(l.phone)).map((l) => ({ phone: l.phone, name: names.get(l.phone) ?? null }));
}
