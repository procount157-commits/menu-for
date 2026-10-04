// ── The weekly report to the owner's phone ────────────────────────
// Once a week, one WhatsApp message to the shop's own phones: what the week
// brought (orders, sales, who came back, who the queue lost, the best item)
// and one thing worth doing next. It is the receipt for the subscription —
// an owner who reads "42 orders, 18 came back" every Sunday does not cancel.
//
// Sent from the shop's own number to its alert phones (or the owner's phone),
// on the staff lane: the owner asked to hear about their own shop.

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  db, orgsTable, branchesTable, usersTable, ownerReportsTable, customersTable, notificationsTable, waAutopilotTable,
  type Org, type Branch, type ReportPrefs,
} from "@workspace/db";
import { addDays, formatMoney, localDate, localParts, vocab, zonedToUtc } from "@workspace/menu-shared";
import { enqueue } from "../notify/outbox";
import { publicUrl, menuPath } from "../menu/urls";
import { logger } from "../logger";

export const DEFAULT_PREFS: ReportPrefs = { enabled: true, weekday: 0, hour: 10 };

export interface WeekStats {
  from: string; to: string;
  orders: number; revenue: number; prevOrders: number; prevRevenue: number; abandoned: number;
  newCustomers: number; returning: number; optedIn: number;
  joined: number; served: number; left: number; noShows: number; avgWait: number | null;
  bookings: number; bookingNoShows: number;
  topItem: { name: string; qty: number } | null;
  sent: number; read: number;
  avgRating: number | null;
  reviewsOn: boolean; autopilotOn: boolean; googleOn: boolean;
}

/** The seven service days that ended this morning: [today-7, today), each starting 04:00 local. */
export function weekWindow(tz: string, now = new Date()) {
  const today = localDate(tz, new Date(now.getTime() - 4 * 3_600_000));
  const from = addDays(today, -7);
  return {
    from, to: addDays(today, -1),
    start: zonedToUtc(tz, from, "04:00"), end: zonedToUtc(tz, today, "04:00"),
    prevStart: zonedToUtc(tz, addDays(from, -7), "04:00"),
  };
}

export async function computeWeek(org: Org, now = new Date()): Promise<WeekStats> {
  const w = weekWindow(org.timezone, now);
  const [o] = (await db.execute<any>(sql`
    SELECT
      count(*) FILTER (WHERE created_at >= ${w.start} AND status NOT IN ('pending','cancelled'))::int AS orders,
      coalesce(sum(subtotal) FILTER (WHERE created_at >= ${w.start} AND status NOT IN ('pending','cancelled')), 0)::float AS revenue,
      count(*) FILTER (WHERE created_at < ${w.start} AND status NOT IN ('pending','cancelled'))::int AS prev_orders,
      coalesce(sum(subtotal) FILTER (WHERE created_at < ${w.start} AND status NOT IN ('pending','cancelled')), 0)::float AS prev_revenue,
      count(*) FILTER (WHERE created_at >= ${w.start} AND status = 'pending')::int AS abandoned
    FROM orders WHERE org_id = ${org.id} AND created_at >= ${w.prevStart} AND created_at < ${w.end}`)).rows;
  const [q] = (await db.execute<any>(sql`
    SELECT count(*)::int AS joined,
      count(*) FILTER (WHERE status IN ('done','serving'))::int AS served,
      count(*) FILTER (WHERE status IN ('left','cancelled'))::int AS left,
      count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
      round(avg(extract(epoch FROM (called_at - joined_at)) / 60) FILTER (WHERE called_at IS NOT NULL))::int AS avg_wait
    FROM queue_tickets WHERE org_id = ${org.id} AND joined_at >= ${w.start} AND joined_at < ${w.end}`)).rows;
  const [b] = (await db.execute<any>(sql`
    SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS bookings, count(*) FILTER (WHERE status = 'no_show')::int AS no_shows
    FROM bookings WHERE org_id = ${org.id} AND starts_at >= ${w.start} AND starts_at < ${w.end}`)).rows;
  const [top] = (await db.execute<any>(sql`
    SELECT max(l->>'name') AS name, sum((l->>'qty')::int)::int AS qty
    FROM orders, jsonb_array_elements(items) l
    WHERE org_id = ${org.id} AND created_at >= ${w.start} AND created_at < ${w.end} AND status NOT IN ('pending','cancelled')
    GROUP BY (l->>'itemId') ORDER BY qty DESC LIMIT 1`)).rows;
  const [c] = await db.select({
    newCustomers: sql<number>`count(*) filter (where first_seen_at >= ${w.start} and first_seen_at < ${w.end})::int`,
    returning: sql<number>`count(*) filter (where last_seen_at >= ${w.start} and first_seen_at < ${w.start})::int`,
    optedIn: sql<number>`count(*) filter (where marketing_opt_in)::int`,
    avgRating: sql<number | null>`round(avg(rating_last)::numeric, 1)::float`,
  }).from(customersTable).where(eq(customersTable.orgId, org.id));
  const [m] = await db.select({
    sent: sql<number>`count(*) filter (where status = 'sent' and class <> 'staff')::int`,
    read: sql<number>`count(*) filter (where read_at is not null and class <> 'staff')::int`,
  }).from(notificationsTable).where(and(eq(notificationsTable.orgId, org.id), gte(notificationsTable.createdAt, w.start), lt(notificationsTable.createdAt, w.end)));
  const [ap] = await db.select({ enabled: waAutopilotTable.enabled }).from(waAutopilotTable).where(and(eq(waAutopilotTable.orgId, org.id), eq(waAutopilotTable.enabled, true))).limit(1);

  return {
    from: w.from, to: w.to,
    orders: o?.orders ?? 0, revenue: o?.revenue ?? 0, prevOrders: o?.prev_orders ?? 0, prevRevenue: o?.prev_revenue ?? 0, abandoned: o?.abandoned ?? 0,
    newCustomers: c?.newCustomers ?? 0, returning: c?.returning ?? 0, optedIn: c?.optedIn ?? 0,
    joined: q?.joined ?? 0, served: q?.served ?? 0, left: q?.left ?? 0, noShows: q?.no_shows ?? 0, avgWait: q?.avg_wait ?? null,
    bookings: b?.bookings ?? 0, bookingNoShows: b?.no_shows ?? 0,
    topItem: top?.name ? { name: top.name, qty: top.qty } : null,
    sent: m?.sent ?? 0, read: m?.read ?? 0,
    avgRating: c?.avgRating ?? null,
    reviewsOn: !!org.features?.reviews, autopilotOn: !!ap, googleOn: !!org.googleReviewUrl,
  };
}

const n = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));
const change = (now: number, before: number) => {
  if (!before && !now) return "";
  if (!before) return " (أول أسبوع فيه طلبات)";
  const d = now - before;
  if (d === 0) return " (مثل الأسبوع الماضي)";
  return d > 0 ? ` (↑ ${n(d)} عن الأسبوع الماضي)` : ` (↓ ${n(-d)} عن الأسبوع الماضي)`;
};

/** One thing worth doing next, from the week's own numbers. Pure. */
export function tipFor(s: WeekStats): string | null {
  if (s.abandoned >= 3) return `${s.abandoned} طلبات بدأها زبائن ولم تكتمل على واتساب — شجّعهم يكتبون رقمهم في السلة، فيتأكد الطلب فوراً.`;
  if (s.left + s.noShows >= 5) return `${s.left + s.noShows} زبائن خرجوا من الصف أو لم يحضروا — اطلب منهم كتابة رقم واتساب عند أخذ الدور، فتصلهم «قرّب دورك».`;
  if (!s.reviewsOn && s.served + s.orders >= 10) return "فعّل «طلب التقييم بعد الزيارة» من «رسائل واتساب» — من يعطي 4 أو 5 نوجّهه لتقييمك على Google.";
  if (s.reviewsOn && !s.googleOn) return "أضف رابط تقييمك على Google في «رسائل واتساب» — من يعطيك 4 أو 5 نرسله ليقيّمك هناك، فيراك زبائن جدد في الخرائط.";
  if (!s.autopilotOn && s.optedIn >= 15) return `${s.optedIn} زبوناً وافقوا على العروض — فعّل «الحملة الأسبوعية» في «واتساب الآلي» ليصلهم عرضك كل أسبوع.`;
  if (s.bookingNoShows >= 2) return `${s.bookingNoShows} حجوزات لم يحضر أصحابها — التذكير قبل الموعد يصل فقط لمن كتب رقمه.`;
  return null;
}

/** The message. Sections with nothing to say are left out. Pure. */
export function formatReport(s: WeekStats, o: { shop: string; currency: string; vertical: string; reportsUrl: string; menuUrl: string }): string {
  const money = (v: number) => formatMoney(v, o.currency, "ar");
  const services = vocab(o.vertical).services;
  const lines = [`📊 *تقرير الأسبوع — ${o.shop}*`, `${s.from} ← ${s.to}`, ""];
  const quiet = !s.orders && !s.joined && !s.bookings && !s.newCustomers;
  if (quiet) {
    lines.push("أسبوع هادئ: لا طلبات ولا دور ولا حجوزات مسجّلة.", `شارك رابط المنيو في حالة الواتساب والإنستغرام: ${o.menuUrl}`);
    return lines.join("\n");
  }
  if (s.orders || s.prevOrders) {
    lines.push(`🛍️ الطلبات: ${n(s.orders)}${change(s.orders, s.prevOrders)}`);
    if (s.revenue) lines.push(`💰 المبيعات: ${money(s.revenue)} · متوسط الطلب ${money(s.revenue / Math.max(1, s.orders))}`);
  }
  if (s.newCustomers || s.returning) lines.push(`👥 الزبائن: ${n(s.newCustomers)} جديد · ${n(s.returning)} رجعوا`);
  if (s.joined) {
    const lost = s.left + s.noShows;
    let q = `⏳ ${services ? "الدور" : "الصف"}: خدمتم ${n(s.served)}`;
    if (s.avgWait != null) q += ` · متوسط الانتظار ${s.avgWait} دقيقة`;
    lines.push(q);
    if (lost) {
      const avg = s.orders ? s.revenue / s.orders : 0;
      lines.push(`🚪 خسرتم من ${services ? "الدور" : "الصف"}: ${n(lost)} (${n(s.left)} خرجوا قبل دورهم · ${n(s.noShows)} لم يحضروا)${!services && avg ? ` ≈ ${money(lost * avg)} فرص ضائعة` : ""}`);
    }
  }
  if (s.bookings) lines.push(`📅 الحجوزات: ${n(s.bookings)}${s.bookingNoShows ? ` · لم يحضر ${n(s.bookingNoShows)}` : ""}`);
  if (s.topItem) lines.push(`⭐ الأكثر طلباً: ${s.topItem.name} (${n(s.topItem.qty)})`);
  if (s.avgRating) lines.push(`🌟 متوسط تقييم زبائنكم: ${s.avgRating} من 5`);
  if (s.sent) lines.push(`💬 رسائل واتساب الآلية: ${n(s.sent)} · فُتح ${Math.round((s.read / s.sent) * 100)}%`);
  const tip = tipFor(s);
  if (tip) lines.push("", `💡 ${tip}`);
  lines.push("", `التفاصيل: ${o.reportsUrl}`);
  return lines.join("\n");
}

/** A phone the owner can be reached on, in international digits, or null. */
export function ownerPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `971${d}`;
  return /^(971|966|965|974|973|968|20)\d{7,10}$/.test(d) ? d : null;
}

async function mainBranch(orgId: number): Promise<Branch | null> {
  const [b] = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, orgId), eq(branchesTable.isActive, true))).orderBy(asc(branchesTable.sort), asc(branchesTable.id)).limit(1);
  return b ?? null;
}

/** Who hears it: the branch's alert phones, or failing that the owner's own phone. */
export async function recipients(org: Org, branch: Branch): Promise<string[]> {
  const phones = (branch.alertPhones ?? []).filter((p) => /^\d{8,15}$/.test(p));
  if (phones.length) return phones;
  const [u] = await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, org.ownerUserId)).limit(1);
  const p = ownerPhone(u?.phone);
  return p ? [p] : [];
}

export async function buildReport(org: Org, now = new Date()) {
  const stats = await computeWeek(org, now);
  const branch = await mainBranch(org.id);
  const text = formatReport(stats, {
    shop: org.name, currency: org.currency, vertical: org.vertical,
    reportsUrl: publicUrl("/reports"), menuUrl: publicUrl(menuPath(org.slug, branch?.slug)),
  });
  return { stats, text, branch };
}

/** Build and send this week's report. `manual` is the owner pressing «أرسله لي الآن» — it does not use up the week. */
export async function sendReport(org: Org, opts: { manual?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const { stats, text, branch } = await buildReport(org, now);
  if (!branch) return { ok: false, reason: "لا يوجد فرع نشط" } as const;
  const to = await recipients(org, branch);
  const manual = opts.manual ? `m${now.getTime() % 1e8}` : null;
  const [row] = await db.insert(ownerReportsTable).values({ orgId: org.id, weekStart: stats.from, stats: stats as any, text, sentTo: to, manual })
    .onConflictDoNothing().returning();
  if (!row) return { ok: false, reason: "أُرسل تقرير هذا الأسبوع من قبل" } as const;
  for (const phone of to) await enqueue({ org, waUserId: branch.waUserId, phone, kind: "owner_report", text, staff: true });
  return { ok: true, to, text, stats } as const;
}

/** Due on the chosen weekday, at or after the chosen hour and before 22:00. Pure. */
export function reportDue(prefs: ReportPrefs | null | undefined, tz: string, now = new Date()): boolean {
  const p = { ...DEFAULT_PREFS, ...(prefs ?? {}) };
  if (!p.enabled) return false;
  const l = localParts(tz, now);
  return l.weekday === p.weekday && l.hour >= p.hour && l.hour < 22;
}

export async function runWeeklyReports(now = new Date()): Promise<number> {
  const orgs = await db.select().from(orgsTable).where(and(eq(orgsTable.status, "active")));
  let sent = 0;
  for (const org of orgs) {
    if (!org.onboardedAt || !reportDue(org.reportPrefs, org.timezone, now)) continue;
    const week = weekWindow(org.timezone, now).from;
    const [done] = await db.select({ id: ownerReportsTable.id }).from(ownerReportsTable)
      .where(and(eq(ownerReportsTable.orgId, org.id), eq(ownerReportsTable.weekStart, week), sql`${ownerReportsTable.manual} IS NULL`)).limit(1);
    if (done) continue;
    const r = await sendReport(org, { now }).catch((err) => { logger.warn({ orgId: org.id, err: String(err?.message ?? err) }, "weekly report failed"); return null; });
    if (r?.ok) sent++;
  }
  return sent;
}

export async function recentReports(orgId: number, limit = 8) {
  return db.select().from(ownerReportsTable).where(eq(ownerReportsTable.orgId, orgId)).orderBy(desc(ownerReportsTable.id)).limit(limit);
}

export function cleanPrefs(b: any, current: ReportPrefs | null | undefined): ReportPrefs {
  const p = { ...DEFAULT_PREFS, ...(current ?? {}) };
  if (typeof b?.enabled === "boolean") p.enabled = b.enabled;
  if (Number.isInteger(b?.weekday) && b.weekday >= 0 && b.weekday <= 6) p.weekday = b.weekday;
  if (Number.isInteger(b?.hour) && b.hour >= 8 && b.hour <= 21) p.hour = b.hour;
  return p;
}

let timer: NodeJS.Timeout | null = null;
export function startWeeklyReports() {
  if (timer) return;
  timer = setInterval(() => { runWeeklyReports().catch(() => {}); }, 10 * 60_000);
  timer.unref?.();
}
