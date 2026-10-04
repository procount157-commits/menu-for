// ── The platform in numbers, for its owner ────────────────────────
// Money (monthly recurring revenue from the plans' own prices), where shops
// fall out between signing up and paying, which signup months are still
// active, what the platform carried each day, where requests come from, and
// which growth tools shops actually switched on.

import { sql } from "drizzle-orm";
import { db, branchesTable } from "@workspace/db";
import { getStatus } from "../whatsapp";

const PAID = ["basic", "pro", "business"];

/** Monthly value of a plan price. Pure. */
export const monthly = (price: number, period: string) => (/year|annual|سنوي/i.test(period) ? price / 12 : price);

export async function platformMetrics() {
  const prices = (await db.execute<any>(sql`SELECT plan_key, price::float AS price, period FROM subscription_plans WHERE is_active AND plan_key IS NOT NULL`)).rows as Array<{ plan_key: string; price: number; period: string }>;
  const priceOf = new Map(prices.map((p) => [p.plan_key, monthly(p.price, p.period)]));
  const paid = sql.join(PAID.map((p) => sql`${p}`), sql`, `);

  const shops = (await db.execute<any>(sql`
    SELECT o.id, o.created_at, o.onboarded_at, o.status, u.plan, u.plan_expires_at, u.last_login_at,
      (u.plan IN (${paid}) AND (u.plan_expires_at IS NULL OR u.plan_expires_at > now()) AND o.status = 'active') AS paying,
      (SELECT count(*)::int FROM menu_items i WHERE i.org_id = o.id) AS items,
      EXISTS (SELECT 1 FROM orders r WHERE r.org_id = o.id AND r.status NOT IN ('pending','cancelled'))
        OR EXISTS (SELECT 1 FROM queue_tickets t WHERE t.org_id = o.id)
        OR EXISTS (SELECT 1 FROM bookings k WHERE k.org_id = o.id) AS used,
      (EXISTS (SELECT 1 FROM orders r WHERE r.org_id = o.id AND r.created_at > now() - interval '14 days')
        OR EXISTS (SELECT 1 FROM queue_tickets t WHERE t.org_id = o.id AND t.joined_at > now() - interval '14 days')
        OR EXISTS (SELECT 1 FROM bookings k WHERE k.org_id = o.id AND k.created_at > now() - interval '14 days')
        OR u.last_login_at > now() - interval '14 days') AS active14,
      (u.plan IN (${paid}) AND u.plan_expires_at BETWEEN now() - interval '30 days' AND now()) AS lapsed,
      o.features
    FROM orgs o JOIN users u ON u.id = o.owner_user_id`)).rows as any[];

  const linked = new Set<number>();
  for (const b of await db.select({ orgId: branchesTable.orgId, waUserId: branchesTable.waUserId }).from(branchesTable)) {
    if ((getStatus(b.waUserId) as { connected?: boolean })?.connected) linked.add(b.orgId);
  }

  const paying = shops.filter((s) => s.paying);
  const mrr = paying.reduce((a, s) => a + (priceOf.get(s.plan) ?? 0), 0);
  const byPlan: Record<string, number> = {};
  for (const s of shops) byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const prevStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);

  const funnel = [
    { key: "signed", label: "سجّلوا", n: shops.length },
    { key: "onboarded", label: "أكملوا التجهيز", n: shops.filter((s) => s.onboarded_at).length },
    { key: "menu", label: "أضافوا 3 أصناف فأكثر", n: shops.filter((s) => s.items >= 3).length },
    { key: "whatsapp", label: "واتساب مربوط الآن", n: shops.filter((s) => linked.has(s.id)).length },
    { key: "used", label: "أول طلب أو دور أو حجز", n: shops.filter((s) => s.used).length },
    { key: "paying", label: "يدفعون الآن", n: paying.length },
  ];

  // Signup months, the last six: how many, still active (last 14 days), paying now.
  const cohorts: Array<{ month: string; signed: number; active: number; paying: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const from = new Date(monthStart.getFullYear(), monthStart.getMonth() - i, 1), to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const c = shops.filter((s) => new Date(s.created_at) >= from && new Date(s.created_at) < to);
    cohorts.push({ month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`, signed: c.length, active: c.filter((s) => s.active14).length, paying: c.filter((s) => s.paying).length });
  }

  const daily = (await db.execute<any>(sql`
    WITH d AS (SELECT generate_series((now() - interval '29 days')::date, now()::date, interval '1 day')::date AS day)
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
      (SELECT count(*)::int FROM orders r WHERE r.created_at::date = d.day AND r.status NOT IN ('pending','cancelled')) AS orders,
      (SELECT count(*)::int FROM queue_tickets t WHERE t.joined_at::date = d.day) AS tickets,
      (SELECT count(*)::int FROM bookings k WHERE k.created_at::date = d.day) AS bookings,
      (SELECT count(*)::int FROM notifications n WHERE n.sent_at::date = d.day AND n.status = 'sent') AS messages
    FROM d ORDER BY d.day`)).rows;

  const leads = (await db.execute<any>(sql`
    SELECT source, status, count(*)::int AS n FROM subscription_leads WHERE created_at > now() - interval '30 days' GROUP BY 1, 2`)).rows as Array<{ source: string; status: string; n: number }>;

  const f = (k: string) => shops.filter((s) => s.features?.[k]).length;
  const [g] = (await db.execute<any>(sql`
    SELECT (SELECT count(*)::int FROM shop_deals WHERE is_active AND source = 'owner') AS deals,
      (SELECT coalesce(sum(amount), 0)::float FROM gift_cards WHERE status <> 'void') AS gift_sales,
      (SELECT count(*)::int FROM wa_autopilot WHERE enabled) AS autopilot,
      (SELECT count(*)::int FROM customer_referrals) AS friend_referrals,
      (SELECT count(*)::int FROM orgs WHERE referred_by_org_id IS NOT NULL) AS shop_referrals`)).rows;

  return {
    money: {
      mrr: Math.round(mrr), arr: Math.round(mrr * 12), paying: paying.length,
      arpa: paying.length ? Math.round(mrr / paying.length) : 0,
      priced: prices.length > 0,
    },
    shops: {
      total: shops.length, byPlan,
      newThisMonth: shops.filter((s) => new Date(s.created_at) >= monthStart).length,
      newLastMonth: shops.filter((s) => new Date(s.created_at) >= prevStart && new Date(s.created_at) < monthStart).length,
      active14: shops.filter((s) => s.active14).length,
      lapsed30: shops.filter((s) => s.lapsed).length,
    },
    funnel, cohorts, daily,
    leads: {
      total: leads.reduce((a, l) => a + l.n, 0),
      bySource: Object.entries(leads.reduce<Record<string, number>>((m, l) => ({ ...m, [l.source]: (m[l.source] ?? 0) + l.n }), {})).map(([source, n]) => ({ source, n })),
      converted: leads.filter((l) => l.status === "converted").reduce((a, l) => a + l.n, 0),
    },
    adoption: [
      { label: "طلب التقييم", n: f("reviews") }, { label: "هدية الميلاد", n: f("birthday") }, { label: "بطاقة الأختام", n: f("loyalty") },
      { label: "ادعُ صديقاً", n: f("referral") }, { label: "بطاقات الهدايا في المنيو", n: f("gifts") },
      { label: "الحملة الأسبوعية", n: g?.autopilot ?? 0 }, { label: "عروض وكوبونات فعّالة", n: g?.deals ?? 0 },
    ],
    growth: { giftSales: g?.gift_sales ?? 0, friendReferrals: g?.friend_referrals ?? 0, shopReferrals: g?.shop_referrals ?? 0 },
  };
}
