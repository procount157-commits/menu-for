// ── «يُطلب معه» ───────────────────────────────────────────────────
// For each item, up to three others to suggest in the cart: first what the
// shop's own customers ordered together in the last 90 days (at least twice),
// then — for a new shop with no history — popular items from a different
// section (a drink with the main, a dessert after), and only then its own. Only items that can be
// added in one tap (no required choices) are suggested.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { PublicItem } from "@workspace/menu-shared";

export type Pairs = Record<number, number[]>;
const cache = new Map<number, { at: number; together: Map<number, Array<[number, number]>>; popularity: Map<number, number> }>();
const TTL = 10 * 60_000;

async function history(orgId: number) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const rows = (await db.execute<any>(sql`
    WITH lines AS (
      SELECT o.id, (l->>'itemId')::int AS item, (l->>'qty')::int AS qty
      FROM orders o, jsonb_array_elements(o.items) l
      WHERE o.org_id = ${orgId} AND o.created_at > now() - interval '90 days' AND o.status NOT IN ('pending','cancelled')
    )
    SELECT a.item AS a, b.item AS b, count(DISTINCT a.id)::int AS n
    FROM lines a JOIN lines b ON a.id = b.id AND a.item <> b.item
    GROUP BY 1, 2`)).rows as Array<{ a: number; b: number; n: number }>;
  const pop = (await db.execute<any>(sql`
    SELECT (l->>'itemId')::int AS item, sum((l->>'qty')::int)::int AS qty
    FROM orders o, jsonb_array_elements(o.items) l
    WHERE o.org_id = ${orgId} AND o.created_at > now() - interval '90 days' AND o.status NOT IN ('pending','cancelled')
    GROUP BY 1`)).rows as Array<{ item: number; qty: number }>;
  const together = new Map<number, Array<[number, number]>>();
  for (const r of rows) together.set(r.a, [...(together.get(r.a) ?? []), [r.b, r.n]]);
  const entry = { at: Date.now(), together, popularity: new Map(pop.map((p) => [p.item, p.qty])) };
  cache.set(orgId, entry);
  return entry;
}

/** Whether an item can go in the cart in one tap. Pure. */
export const oneTap = (i: Pick<PublicItem, "available" | "options">) => i.available && !(i.options ?? []).some((g) => g.required || (g.min ?? 0) > 0);

/** The suggestions, from history and a cold-start fallback. Pure. */
export function buildPairs(items: PublicItem[], together: Map<number, Array<[number, number]>>, popularity: Map<number, number>, per = 3): Pairs {
  const byId = new Map(items.map((i) => [i.id, i]));
  const candidates = items.filter(oneTap);
  const score = (i: PublicItem) => (popularity.get(i.id) ?? 0) * 10 + (i.tags.includes("popular") ? 5 : 0) + (i.tags.includes("chef") ? 3 : 0) + (i.tags.includes("new") ? 1 : 0);
  const out: Pairs = {};
  for (const item of items) {
    const picks: number[] = [];
    for (const [b, n] of [...(together.get(item.id) ?? [])].sort((x, y) => y[1] - x[1])) {
      if (n < 2 || picks.length >= per) continue;
      const other = byId.get(b);
      if (other && oneTap(other)) picks.push(b);
    }
    // Then the best of each other section in turn — a drink, a dessert, a
    // side, not three desserts — and a one-section menu falls back to its own.
    const others = new Map<number | null, PublicItem[]>();
    for (const c of [...candidates].sort((a, b) => score(b) - score(a) || a.price - b.price)) {
      if (c.id === item.id || picks.includes(c.id) || c.categoryId === item.categoryId) continue;
      others.set(c.categoryId, [...(others.get(c.categoryId) ?? []), c]);
    }
    const sections = [...others.values()].sort((a, b) => score(b[0]!) - score(a[0]!));
    for (let round = 0; picks.length < per && sections.some((sec) => sec[round]); round++) {
      for (const sec of sections) { if (picks.length >= per) break; if (sec[round]) picks.push(sec[round]!.id); }
    }
    for (const c of [...candidates].filter((c) => c.categoryId === item.categoryId && c.id !== item.id && !picks.includes(c.id)).sort((a, b) => score(b) - score(a) || a.price - b.price)) {
      if (picks.length >= per) break;
      picks.push(c.id);
    }
    if (picks.length) out[item.id] = picks;
  }
  return out;
}

export async function pairsFor(orgId: number, items: PublicItem[]): Promise<Pairs> {
  const h = await history(orgId);
  return buildPairs(items, h.together, h.popularity);
}

export const forgetPairs = (orgId: number) => cache.delete(orgId);
