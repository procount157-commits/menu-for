// ── Goals, and the three kinds of number each one is judged by ───
// A goal is the owner's: a number, a deadline, and nothing an employee can
// edit. Each is read through three kinds of measure, because a team pushed
// at one number learns to move the number rather than the business:
//
//   the target    what the team chases            — shops paying, orders
//   the counters  what chasing it must not cost   — stops, bounces, no-shows
//   the anchor    a fact the system cannot write  — a plan the admin set on a
//                                                   shop; an order the shop's
//                                                   staff marked completed
//
// Menu For You has two owners of goals, and each reads its own numbers:
//
//   the platform (an admin account) — shops: signed up, live with a menu,
//     brought in by the seller, and paying. There is no payment record in
//     Menu For You; what a shop pays is the plan the admin puts it on, so
//     the anchor is a shop that signed up in the window and is on a priced
//     plan that has not lapsed. No employee can set a plan.
//   a branch (a shop's WhatsApp account) — its customers: orders the staff
//     completed, bookings that arrived, turns served. Customers and staff
//     write those rows; the AI team never does.
//
// Measures are named here and computed by fixed queries. A goal row names
// one; nothing reaches the database as free SQL from a goal or an agent.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type Window = { userId: number; from: Date; to: Date };
export type Scope = "platform" | "shop" | "any";
type Measure = { label: string; scope: Scope; unit?: string; read: (w: Window) => Promise<number> };

const one = async (q: ReturnType<typeof sql>) => Number(((await db.execute<{ n: number }>(q)).rows[0] as any)?.n ?? 0);
/** The branches this Flow Hub account is. */
const branchesOf = (w: Window) => sql`(SELECT id FROM branches WHERE wa_user_id = ${w.userId})`;
/** A shop owner, not the platform's own admin accounts. */
const realShop = sql`NOT coalesce(u.is_admin, false)`;
/** On a plan with a price, not lapsed. */
const paying = sql`EXISTS (SELECT 1 FROM subscription_plans p WHERE p.plan_key = u.plan AND p.price > 0) AND (u.plan_expires_at IS NULL OR u.plan_expires_at > now())`;

export const MEASURES: Record<string, Measure> = {
  // ── The platform: shops ────────────────────────────────────────
  // The anchor: a plan only the admin can set.
  shops_paying: { label: "محلات جديدة على خطة مدفوعة", scope: "platform", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM orgs o JOIN users u ON u.id = o.owner_user_id
    WHERE ${realShop} AND ${paying} AND o.created_at >= ${w.from} AND o.created_at < ${w.to}`) },
  shops_signed: { label: "محلات سجّلت", scope: "platform", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM orgs o JOIN users u ON u.id = o.owner_user_id
    WHERE ${realShop} AND o.created_at >= ${w.from} AND o.created_at < ${w.to}`) },
  shops_live: { label: "محلات منيوها شغّال (فيه أصناف)", scope: "platform", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM orgs o JOIN users u ON u.id = o.owner_user_id
    WHERE ${realShop} AND o.created_at >= ${w.from} AND o.created_at < ${w.to}
      AND EXISTS (SELECT 1 FROM menu_items i WHERE i.org_id = o.id)`) },
  shops_from_sales: { label: "محلات سجّلت من مستشارة المبيعات", scope: "platform", read: (w) => one(sql`
    SELECT count(DISTINCT p.org_id)::int AS n FROM sales_prospects p JOIN orgs o ON o.id = p.org_id
    WHERE o.created_at >= ${w.from} AND o.created_at < ${w.to}`) },
  prospect_replies: { label: "أصحاب محلات ردّوا على واتساب", scope: "platform", read: (w) => one(sql`
    SELECT count(DISTINCT prospect_id)::int AS n FROM sales_touches WHERE kind = 'inbound' AND at >= ${w.from} AND at < ${w.to}`) },
  email_replies: { label: "ردود على الإيميل", scope: "platform", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM email_inbound WHERE user_id = ${w.userId} AND received_at >= ${w.from} AND received_at < ${w.to}`) },
  // Counters: what the chase must not cost.
  sales_stops: { label: "محلات طلبت ألا نراسلها", scope: "platform", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM sales_prospects WHERE stage = 'stopped' AND updated_at >= ${w.from} AND updated_at < ${w.to}`) },
  email_bounce_pct: { label: "نسبة ارتداد الإيميل", scope: "platform", unit: "%", read: async (w) => {
    const r = (await db.execute<{ sent: number; bounced: number }>(sql`SELECT count(*) FILTER (WHERE status IN ('sent','bounced'))::int AS sent, count(*) FILTER (WHERE status = 'bounced')::int AS bounced
      FROM email_messages WHERE user_id = ${w.userId} AND coalesce(sent_at, created_at) >= ${w.from} AND coalesce(sent_at, created_at) < ${w.to}`)).rows[0] as any;
    return Number(r?.sent) ? Math.round((1000 * Number(r.bounced)) / Number(r.sent)) / 10 : 0;
  } },

  // ── A branch: its customers ────────────────────────────────────
  // The anchor: the shop's staff mark an order completed; no employee can.
  orders_completed: { label: "طلبات اكتملت", scope: "shop", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM orders WHERE branch_id IN ${branchesOf(w)} AND status = 'completed' AND updated_at >= ${w.from} AND updated_at < ${w.to}`) },
  bookings_kept: { label: "حجوزات حضر أصحابها", scope: "shop", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM bookings WHERE branch_id IN ${branchesOf(w)} AND status IN ('arrived','done') AND starts_at >= ${w.from} AND starts_at < ${w.to}`) },
  turns_served: { label: "أدوار خُدم أصحابها", scope: "shop", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM queue_tickets WHERE branch_id IN ${branchesOf(w)} AND status = 'done' AND finished_at >= ${w.from} AND finished_at < ${w.to}`) },
  // Counters.
  no_shows: { label: "حجوزات لم يحضر أصحابها", scope: "shop", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM bookings WHERE branch_id IN ${branchesOf(w)} AND status = 'no_show' AND starts_at >= ${w.from} AND starts_at < ${w.to}`) },
  turns_left: { label: "زبائن مشوا قبل دورهم", scope: "shop", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM queue_tickets WHERE branch_id IN ${branchesOf(w)} AND status IN ('left','no_show') AND joined_at >= ${w.from} AND joined_at < ${w.to}`) },

  // ── Either ─────────────────────────────────────────────────────
  wa_replies: { label: "أشخاص ردّوا على واتساب (لا ردود آلية)", scope: "any", read: (w) => one(sql`
    SELECT count(DISTINCT phone)::int AS n FROM auto_reply_log WHERE user_id = ${w.userId} AND created_at >= ${w.from} AND created_at < ${w.to} AND coalesce(skipped,'') NOT LIKE 'رد آلي%'`) },
  stops: { label: "طلبات إيقاف وضغطات «إيقاف الرسائل»", scope: "any", read: (w) => one(sql`
    SELECT count(*)::int AS n FROM unsubscribed_phones WHERE user_id = ${w.userId} AND created_at >= ${w.from} AND created_at < ${w.to}`) },
};

/** Per scope: the anchor no employee can write, what leads to it, and what it must not cost. Pure data. */
export const FAMILY: Record<"platform" | "shop", { anchor: string; leading: string[]; counters: string[] }> = {
  platform: { anchor: "shops_paying", leading: ["shops_signed", "shops_live", "shops_from_sales", "prospect_replies", "email_replies"], counters: ["stops", "sales_stops", "email_bounce_pct"] },
  shop: { anchor: "orders_completed", leading: ["bookings_kept", "turns_served", "wa_replies"], counters: ["stops", "no_shows", "turns_left"] },
};

/** Which family a measure reads as; an «any» measure follows the account. Pure. */
export function familyOf(metric: string, isAdmin: boolean): "platform" | "shop" {
  const s = MEASURES[metric]?.scope;
  return s === "platform" ? "platform" : s === "shop" ? "shop" : isAdmin ? "platform" : "shop";
}

/** May this account set a goal on this measure? Platform numbers are the admin's alone. Pure. */
export function mayUse(metric: string, isAdmin: boolean): boolean {
  const m = MEASURES[metric];
  return !!m && (m.scope !== "platform" || isAdmin);
}

export type GoalRow = { id: number; title: string; metric: string; target: number; starts_at: Date; deadline: Date; counter_metrics: string[]; anchor: string | null; status: string };

/** Where a goal stands: how far, how fast it has to go now. Pure over the numbers. */
export function pace(current: number, target: number, start: Date, deadline: Date, now = new Date()) {
  const total = Math.max(1, deadline.getTime() - start.getTime());
  const elapsed = Math.min(total, Math.max(0, now.getTime() - start.getTime()));
  const daysLeft = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000));
  const expected = Math.round((target * elapsed) / total * 10) / 10;
  const remaining = Math.max(0, target - current);
  const perWeek = daysLeft ? Math.round((remaining / daysLeft) * 7 * 10) / 10 : remaining;
  const state = current >= target ? "done" : now > deadline ? "missed" : current >= expected ? "on_track" : "behind";
  return { current, target, expected, remaining, daysLeft, perWeek, state } as const;
}

async function isAdminUser(userId: number): Promise<boolean> {
  const r = await db.execute<{ a: boolean }>(sql`SELECT is_admin AS a FROM users WHERE id = ${userId}`);
  return !!r.rows[0]?.a;
}

export async function goalsWithProgress(userId: number, now = new Date()) {
  const admin = await isAdminUser(userId);
  const rows = (await db.execute<GoalRow>(sql`SELECT * FROM goals WHERE user_id = ${userId} AND status = 'active' ORDER BY id`)).rows;
  const allowed = (k: string) => !!MEASURES[k] && mayUse(k, admin);
  return Promise.all(rows.map(async (g) => {
    const w = { userId, from: new Date(g.starts_at), to: new Date(Math.min(now.getTime() + 1, new Date(g.deadline).getTime())) };
    const fam = FAMILY[familyOf(g.metric, admin)];
    const m = allowed(g.metric) ? MEASURES[g.metric] : undefined;
    const current = m ? await m.read(w) : 0;
    const counters = await Promise.all((g.counter_metrics ?? []).filter(allowed).map(async (k) => ({ key: k, label: MEASURES[k]!.label, unit: MEASURES[k]!.unit ?? "", value: await MEASURES[k]!.read(w) })));
    const leading = await Promise.all([fam.anchor, ...fam.leading].filter((k) => k !== g.metric && allowed(k)).map(async (k) => ({ key: k, label: MEASURES[k]!.label, value: await MEASURES[k]!.read(w) })));
    return { ...g, label: m?.label ?? g.metric, anchorLabel: g.anchor && MEASURES[g.anchor] ? MEASURES[g.anchor]!.label : null, progress: pace(current, g.target, new Date(g.starts_at), new Date(g.deadline), now), counters, leading };
  }));
}

/** The measures this account may set a goal on, for the owner's form. */
export async function measuresFor(userId: number) {
  const admin = await isAdminUser(userId);
  return Object.entries(MEASURES).filter(([k]) => mayUse(k, admin)).map(([key, m]) => ({ key, label: m.label, scope: m.scope, unit: m.unit ?? "" }));
}

/**
 * The owner sets a goal. Employees have no path here. The counters and the
 * anchor default to the measure's family; a platform measure is the admin's
 * alone.
 */
export async function setGoal(userId: number, g: { title: string; metric: string; target: number; deadline: Date; startsAt?: Date; counters?: string[]; anchor?: string | null }) {
  if (!MEASURES[g.metric]) throw new Error(`مقياس غير معروف: ${g.metric}`);
  const admin = await isAdminUser(userId);
  if (!mayUse(g.metric, admin)) throw new Error("هذا المقياس لأرقام المنصة — لمدير المنصة فقط");
  const fam = FAMILY[familyOf(g.metric, admin)];
  const counters = (g.counters?.length ? g.counters : fam.counters).filter((k) => MEASURES[k] && mayUse(k, admin));
  const anchor = g.anchor && MEASURES[g.anchor] && mayUse(g.anchor, admin) ? g.anchor : fam.anchor;
  const r = await db.execute<{ id: number }>(sql`INSERT INTO goals (user_id, title, metric, target, starts_at, deadline, counter_metrics, anchor)
    VALUES (${userId}, ${g.title}, ${g.metric}, ${g.target}, ${g.startsAt ?? new Date()}, ${g.deadline}, ${JSON.stringify(counters)}::jsonb, ${anchor}) RETURNING id`);
  return Number(r.rows[0]!.id);
}

/** The owner ends a goal; it is kept, marked, never deleted. */
export async function closeGoal(userId: number, id: number, status: "done" | "dropped") {
  await db.execute(sql`UPDATE goals SET status = ${status} WHERE id = ${id} AND user_id = ${userId}`);
}
