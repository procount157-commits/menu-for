// ── What the owner's assistant knows about the shop ───────────────
// Flow Hub's assistant is handed the account's campaign numbers so it never
// invents one; this is the same for the shop: today's queue, orders and
// bookings per branch, the customer list, the week's best sellers.

import { and, eq, gte, sql } from "drizzle-orm";
import { db, branchesTable, orgsTable, queuesTable, ordersTable, bookingsTable, customersTable } from "@workspace/db";
import { formatEta, formatMoney, localDate, zonedToUtc, DAY_ROLLOVER_HOUR, vocab } from "@workspace/menu-shared";
import { queueCtx, snapshot, etaAt } from "../queue/engine";

export async function shopContext(waUserId: number): Promise<string> {
  const rows = await db.select({ b: branchesTable, o: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId)).where(eq(branchesTable.waUserId, waUserId));
  if (!rows.length) return "";
  const org = rows[0]!.o;
  const tz = org.timezone;
  const dayStart = zonedToUtc(tz, localDate(tz, new Date(Date.now() - DAY_ROLLOVER_HOUR * 3_600_000)), `0${DAY_ROLLOVER_HOUR}:00`);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
  const money = (n: number) => formatMoney(n, org.currency, "ar");
  const lines: string[] = [`المحل: ${org.name} (${vocab(org.vertical).label[0]}) — الرابط /${org.slug}`];

  for (const { b } of rows) {
    const qs = await db.select().from(queuesTable).where(and(eq(queuesTable.branchId, b.id), eq(queuesTable.isActive, true)));
    const parts: string[] = [];
    for (const q of qs) {
      const ctx = await queueCtx(q.id);
      if (!ctx) continue;
      const s = await snapshot(ctx);
      parts.push(`${q.name}: ${q.isOpen ? (q.isPaused ? "متوقف مؤقتاً" : "مفتوح") : "مغلق"}، بالانتظار ${s.waiting.length}، خُدم اليوم ${s.servedToday}، لم يحضر ${s.noShowsToday}، متوسط الانتظار ${s.avgWaitToday ?? "—"} دقيقة، الوقت لمن ينضم الآن ${formatEta(etaAt(s, s.waiting.length))}`);
    }
    const [o] = await db.select({
      n: sql<number>`count(*) filter (where status not in ('pending','cancelled'))::int`,
      open: sql<number>`count(*) filter (where status in ('received','preparing','ready'))::int`,
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      revenue: sql<number>`coalesce(sum(subtotal) filter (where status not in ('pending','cancelled')), 0)::float`,
    }).from(ordersTable).where(and(eq(ordersTable.branchId, b.id), gte(ordersTable.createdAt, dayStart)));
    const [bk] = await db.select({ n: sql<number>`count(*)::int` }).from(bookingsTable)
      .where(and(eq(bookingsTable.branchId, b.id), gte(bookingsTable.startsAt, dayStart), sql`${bookingsTable.startsAt} < ${new Date(dayStart.getTime() + 24 * 3_600_000)}`, sql`${bookingsTable.status} <> 'cancelled'`));
    lines.push(`${b.name}: ${parts.join(" · ") || "لا صف"} · طلبات اليوم ${o?.n ?? 0} (${money(o?.revenue ?? 0)})، مفتوحة ${o?.open ?? 0}، لم تصل رسالتها ${o?.pending ?? 0} · حجوزات اليوم ${bk?.n ?? 0}`);
  }

  const [c] = await db.select({
    total: sql<number>`count(*)::int`,
    returning: sql<number>`count(*) filter (where visits + orders_count >= 2)::int`,
    optIn: sql<number>`count(*) filter (where marketing_opt_in)::int`,
    rating: sql<number | null>`round(avg(rating_last)::numeric, 1)::float`,
  }).from(customersTable).where(eq(customersTable.orgId, org.id));
  lines.push(`الزبائن: ${c?.total ?? 0}، يعودون ${c?.returning ?? 0}، وافقوا على العروض ${c?.optIn ?? 0}، متوسط التقييم ${c?.rating ?? "—"}`);

  const top = await db.execute<{ name: string; qty: number }>(sql`
    SELECT max(l->>'name') AS name, sum((l->>'qty')::int)::int AS qty
    FROM orders, jsonb_array_elements(items) l
    WHERE org_id = ${org.id} AND created_at >= ${weekAgo} AND status NOT IN ('pending','cancelled')
    GROUP BY l->>'itemId' ORDER BY qty DESC LIMIT 5`);
  if (top.rows.length) lines.push(`الأكثر طلباً هذا الأسبوع: ${top.rows.map((r) => `${r.name} (${r.qty})`).join("، ")}`);
  return lines.join("\n");
}
