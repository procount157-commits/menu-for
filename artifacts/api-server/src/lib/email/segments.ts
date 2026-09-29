// ── Audiences ─────────────────────────────────────────────────────
// A segment is a saved filter, resolved when it is used — so "brokers in
// Dubai who opened and did not reply" is still that on the day a campaign
// starts, not a snapshot of last week. The same filter drives the contacts
// table, the counts beside each filter, campaigns, sequences and missions.

import { and, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, emailContactsTable, emailListMembersTable, type SegmentFilter } from "@workspace/db";
import { UNCLASSIFIED } from "./sector";

export const ENGAGEMENT: Record<string, string> = {
  never_sent: "لم يُراسَل بعد",
  sent_no_open: "أُرسل ولم يفتح",
  opened_no_reply: "فتح ولم يرد",
  clicked: "نقر رابطاً",
  replied: "ردّ",
};

const c = emailContactsTable;

export function conditions(userId: number, f: SegmentFilter = {}): SQL[] {
  const out: SQL[] = [eq(c.userId, userId)];
  if (f.sectors?.length) {
    const named = f.sectors.filter((s) => s !== UNCLASSIFIED);
    const parts: SQL[] = [];
    if (named.length) parts.push(inArray(c.sector, named));
    if (f.sectors.includes(UNCLASSIFIED)) parts.push(isNull(c.sector));
    out.push(parts.length === 1 ? parts[0]! : or(...parts)!);
  }
  if (f.cities?.length) out.push(inArray(c.city, f.cities));
  if (f.statuses?.length) out.push(inArray(c.status, f.statuses));
  if (f.hasPhone) out.push(isNotNull(c.phone));
  if (f.listIds?.length) {
    out.push(inArray(c.id, db.select({ id: emailListMembersTable.contactId }).from(emailListMembersTable).where(inArray(emailListMembersTable.listId, f.listIds))));
  }
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    out.push(or(ilike(c.email, q), ilike(c.company, q), ilike(c.name, q))!);
  }
  if (f.engagement?.length) {
    const e: SQL[] = [];
    for (const k of f.engagement) {
      if (k === "never_sent") e.push(sql`${c.lastSentAt} is null`);
      if (k === "sent_no_open") e.push(sql`(${c.lastSentAt} is not null and ${c.lastOpenedAt} is null and ${c.lastRepliedAt} is null)`);
      if (k === "opened_no_reply") e.push(sql`(${c.lastOpenedAt} is not null and ${c.lastRepliedAt} is null)`);
      if (k === "replied") e.push(sql`${c.lastRepliedAt} is not null`);
      if (k === "clicked") e.push(sql`exists (select 1 from email_messages m where m.contact_id = ${c.id} and m.clicked_at is not null)`);
    }
    if (e.length) out.push(or(...e)!);
  }
  return out;
}

export function cleanFilter(raw: any): SegmentFilter {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 50) : undefined);
  const f: SegmentFilter = {};
  if (arr(raw?.sectors)?.length) f.sectors = arr(raw.sectors);
  if (arr(raw?.cities)?.length) f.cities = arr(raw.cities);
  if (arr(raw?.statuses)?.length) f.statuses = arr(raw.statuses);
  const eng = (arr(raw?.engagement) ?? []).filter((k) => k in ENGAGEMENT);
  if (eng.length) f.engagement = eng;
  if (Array.isArray(raw?.listIds) && raw.listIds.length) f.listIds = raw.listIds.map(Number).filter(Boolean).slice(0, 50);
  if (typeof raw?.q === "string" && raw.q.trim()) f.q = raw.q.trim().slice(0, 100);
  if (raw?.hasPhone === true || raw?.hasPhone === "true") f.hasPhone = true;
  return f;
}

/** The contacts a filter selects. `sendable` adds what sending always requires. */
export async function resolve(userId: number, f: SegmentFilter, opts: { sendable?: boolean; limit?: number } = {}) {
  const conds = conditions(userId, f);
  if (opts.sendable) conds.push(eq(c.status, "active"), sql`coalesce(${c.mxOk}, true)`);
  const q = db.select().from(c).where(and(...conds)).orderBy(c.id);
  return opts.limit ? q.limit(opts.limit) : q;
}

export async function count(userId: number, f: SegmentFilter, sendable = false): Promise<number> {
  const conds = conditions(userId, f);
  if (sendable) conds.push(eq(c.status, "active"), sql`coalesce(${c.mxOk}, true)`);
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(c).where(and(...conds));
  return Number(r?.n ?? 0);
}

/**
 * The counts beside each filter. Each facet is counted with the other
 * facets applied and its own left out, so the numbers say what choosing it
 * would give — the way a shop's filters work.
 */
export async function facets(userId: number, f: SegmentFilter = {}) {
  const without = (k: keyof SegmentFilter) => { const g = { ...f }; delete g[k]; return and(...conditions(userId, g)); };
  const [sectors, cities, statuses, eng] = await Promise.all([
    db.select({ k: sql<string>`coalesce(${c.sector}, ${UNCLASSIFIED})`, n: sql<number>`count(*)` }).from(c).where(without("sectors")).groupBy(sql`1`).orderBy(sql`2 desc`),
    db.select({ k: sql<string>`coalesce(${c.city}, '—')`, n: sql<number>`count(*)` }).from(c).where(without("cities")).groupBy(sql`1`).orderBy(sql`2 desc`).limit(40),
    db.select({ k: c.status, n: sql<number>`count(*)` }).from(c).where(without("statuses")).groupBy(c.status),
    db.select({
      never_sent: sql<number>`count(*) filter (where ${c.lastSentAt} is null)`,
      sent_no_open: sql<number>`count(*) filter (where ${c.lastSentAt} is not null and ${c.lastOpenedAt} is null and ${c.lastRepliedAt} is null)`,
      opened_no_reply: sql<number>`count(*) filter (where ${c.lastOpenedAt} is not null and ${c.lastRepliedAt} is null)`,
      replied: sql<number>`count(*) filter (where ${c.lastRepliedAt} is not null)`,
      withPhone: sql<number>`count(*) filter (where ${c.phone} is not null)`,
    }).from(c).where(without("engagement")),
  ]);
  const e: Record<string, unknown> = eng[0] ?? {};
  return {
    sectors: sectors.map((r) => ({ key: r.k, n: Number(r.n) })),
    cities: cities.map((r) => ({ key: r.k, n: Number(r.n) })),
    statuses: statuses.map((r) => ({ key: r.k, n: Number(r.n) })),
    engagement: Object.keys(ENGAGEMENT).filter((k) => k !== "clicked").map((k) => ({ key: k, label: ENGAGEMENT[k], n: Number(e[k] ?? 0) })),
    withPhone: Number(e.withPhone ?? 0),
    total: await count(userId, f),
  };
}

/** A filter in words, for a campaign name, a prompt, or a report. */
export function describe(f: SegmentFilter): string {
  const parts: string[] = [];
  if (f.sectors?.length) parts.push(f.sectors.join(" و"));
  if (f.cities?.length) parts.push(`في ${f.cities.join("، ")}`);
  if (f.engagement?.length) parts.push(f.engagement.map((k) => ENGAGEMENT[k] ?? k).join(" أو "));
  if (f.hasPhone) parts.push("لهم رقم واتساب");
  if (f.q) parts.push(`«${f.q}»`);
  return parts.join(" · ") || "كل جهات الاتصال";
}
