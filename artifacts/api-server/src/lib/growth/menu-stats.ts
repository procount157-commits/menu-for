// ── What customers look at on the menu ────────────────────────────
// The menu page sends small batches: the menu opened, an item opened, an
// item added, the cart opened. They become daily counters per item — no
// visitor is identified or stored. Next to the orders, they answer what an
// owner cannot see from the till: what is looked at and not bought.

import { sql } from "drizzle-orm";
import { db, menuStatsDailyTable, type Org } from "@workspace/db";
import { localDate } from "@workspace/menu-shared";

export type MenuEvent = { k: "menu" | "item" | "add" | "cart" | "upsell"; id?: number };

// A page left open or reloaded must not count the same look again: one
// session counts a menu, an item, or the cart once per half hour.
const seen = new Map<string, number>();
const ONCE_MS = 30 * 60_000;
function firstTime(key: string, now: number) {
  const at = seen.get(key);
  if (at && now - at < ONCE_MS) return false;
  seen.set(key, now);
  if (seen.size > 50_000) for (const [k, t] of seen) if (now - t > ONCE_MS) seen.delete(k);
  return true;
}

/** Events cleaned and folded into counters per item. Pure apart from the session memory. */
export function fold(sid: string, events: unknown, validItems: Set<number>, now = Date.now()) {
  const out = new Map<number, { views: number; adds: number; carts: number; upsells: number }>();
  const bump = (id: number, k: "views" | "adds" | "carts" | "upsells") => {
    const r = out.get(id) ?? { views: 0, adds: 0, carts: 0, upsells: 0 };
    r[k]++; out.set(id, r);
  };
  for (const e of (Array.isArray(events) ? events : []).slice(0, 50) as MenuEvent[]) {
    const id = Number(e?.id) || 0;
    if (e?.k === "menu") { if (firstTime(`${sid}|m`, now)) bump(0, "views"); }
    else if (e?.k === "cart") { if (firstTime(`${sid}|c`, now)) bump(0, "carts"); }
    else if ((e?.k === "item" || e?.k === "add" || e?.k === "upsell") && validItems.has(id)) {
      if (e.k === "item") { if (firstTime(`${sid}|i${id}`, now)) bump(id, "views"); }
      else { bump(id, "adds"); if (e.k === "upsell") bump(id, "upsells"); } // every add counts: two adds are two in the cart
    }
  }
  return out;
}

export async function record(org: Pick<Org, "id" | "timezone">, branchId: number, counts: Map<number, { views: number; adds: number; carts: number; upsells?: number }>, now = new Date()) {
  if (!counts.size) return;
  const day = localDate(org.timezone, now);
  for (const [itemId, c] of counts) {
    await db.insert(menuStatsDailyTable).values({ orgId: org.id, branchId, day, itemId, views: c.views, adds: c.adds, carts: c.carts, upsells: c.upsells ?? 0 })
      .onConflictDoUpdate({
        target: [menuStatsDailyTable.orgId, menuStatsDailyTable.branchId, menuStatsDailyTable.day, menuStatsDailyTable.itemId],
        set: { views: sql`${menuStatsDailyTable.views} + ${c.views}`, adds: sql`${menuStatsDailyTable.adds} + ${c.adds}`, carts: sql`${menuStatsDailyTable.carts} + ${c.carts}`, upsells: sql`${menuStatsDailyTable.upsells} + ${c.upsells ?? 0}` },
      });
  }
}

/** Looked at a lot, rarely ordered: worth a better photo, a clearer description or a price check. Pure. */
export function lookedNotBought<T extends { views: number; ordered: number }>(items: T[], minViews = 10): T[] {
  return items
    .filter((i) => i.views >= minViews && i.ordered / i.views < 0.05)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
}

export async function menuReport(org: Org, branchIds: number[], days: number) {
  const since = localDate(org.timezone, new Date(Date.now() - (days - 1) * 24 * 3_600_000));
  const ids = sql.join(branchIds.map((i) => sql`${i}`), sql`, `);
  const [f] = (await db.execute<any>(sql`
    SELECT coalesce(sum(views) FILTER (WHERE item_id = 0), 0)::int AS menu_views,
      coalesce(sum(views) FILTER (WHERE item_id <> 0), 0)::int AS item_views,
      coalesce(sum(adds), 0)::int AS adds,
      coalesce(sum(carts), 0)::int AS carts,
      coalesce(sum(upsells), 0)::int AS upsells
    FROM menu_stats_daily WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND day >= ${since}`)).rows;
  const sinceTs = sql`(${since}::date::timestamp AT TIME ZONE ${org.timezone})`;
  const [o] = (await db.execute<any>(sql`
    SELECT count(*) FILTER (WHERE status NOT IN ('pending','cancelled'))::int AS orders,
      coalesce(avg(subtotal - discount) FILTER (WHERE status NOT IN ('pending','cancelled')), 0)::float AS avg_order
    FROM orders WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND created_at >= ${sinceTs}`)).rows;
  const items = (await db.execute<any>(sql`
    WITH s AS (
      SELECT item_id, sum(views)::int AS views, sum(adds)::int AS adds
      FROM menu_stats_daily WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND day >= ${since} AND item_id <> 0 GROUP BY item_id
    ), o AS (
      SELECT (l->>'itemId')::int AS item_id, sum((l->>'qty')::int)::int AS ordered
      FROM orders, jsonb_array_elements(items) l
      WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND created_at >= ${sinceTs} AND status NOT IN ('pending','cancelled')
      GROUP BY 1
    )
    SELECT m.id AS item_id, m.name, coalesce(s.views, 0) AS views, coalesce(s.adds, 0) AS adds, coalesce(o.ordered, 0) AS ordered
    FROM menu_items m LEFT JOIN s ON s.item_id = m.id LEFT JOIN o ON o.item_id = m.id
    WHERE m.org_id = ${org.id} AND (s.views > 0 OR o.ordered > 0)
    ORDER BY coalesce(s.views, 0) DESC, coalesce(o.ordered, 0) DESC LIMIT 40`)).rows as Array<{ item_id: number; name: string; views: number; adds: number; ordered: number }>;
  const hours = (await db.execute<any>(sql`
    SELECT extract(hour FROM created_at AT TIME ZONE ${org.timezone})::int AS hour, count(*)::int AS orders
    FROM orders WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND created_at >= ${sinceTs} AND status NOT IN ('pending','cancelled')
    GROUP BY 1 ORDER BY 1`)).rows as Array<{ hour: number; orders: number }>;
  const [q] = (await db.execute<any>(sql`
    SELECT count(*) FILTER (WHERE status IN ('left','cancelled','no_show'))::int AS lost
    FROM queue_tickets WHERE org_id = ${org.id} AND branch_id IN (${ids}) AND joined_at >= ${sinceTs}`)).rows;
  const avgOrder = o?.avg_order ?? 0;
  return {
    days, since,
    funnel: { menuViews: f?.menu_views ?? 0, itemViews: f?.item_views ?? 0, adds: f?.adds ?? 0, carts: f?.carts ?? 0, orders: o?.orders ?? 0, upsells: f?.upsells ?? 0 },
    items, lookedNotBought: lookedNotBought(items),
    byHour: hours,
    lostQueue: { people: q?.lost ?? 0, avgOrder, value: Math.round((q?.lost ?? 0) * avgOrder) },
  };
}
