// ── /api/customers, /api/wa-templates, /api/reports, /api/qr ──────

import { Router } from "express";
import QRCode from "qrcode";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  db, customersTable, queueTicketsTable, ordersTable, bookingsTable, queueEventsTable, branchesTable, orgsTable,
} from "@workspace/db";
import { localDate, addDays, zonedToUtc, TEMPLATE_VARS } from "@workspace/menu-shared";
import { requireAuth } from "../lib/auth";
import { withTenant, MANAGERS, OWNER } from "../lib/tenancy/context";
import { listTemplates, saveTemplate } from "../lib/notify/templates";
import { recentNotifications, notifyStats } from "../lib/notify/outbox";
import { publicUrl, menuPath, displayPath, joinKey } from "../lib/menu/urls";
import { menuPlan } from "../lib/plans";

const router = Router();

// ── Customers ─────────────────────────────────────────────────────

router.get("/customers", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const q = String(req.query.q ?? "").trim();
  const sort = String(req.query.sort ?? "recent");
  const order = sort === "visits" ? desc(customersTable.visits) : sort === "spent" ? desc(customersTable.totalSpent) : desc(customersTable.lastSeenAt);
  const where = and(
    eq(customersTable.orgId, t.org.id),
    ...(q ? [or(ilike(customersTable.name, `%${q}%`), ilike(customersTable.phone, `%${q.replace(/\D/g, "") || q}%`))!] : []),
    ...(req.query.optIn === "1" ? [eq(customersTable.marketingOptIn, true)] : []),
  );
  const rows = await db.select().from(customersTable).where(where).orderBy(order).limit(Math.min(500, Number(req.query.limit) || 200));
  const [stats] = await db.select({
    total: sql<number>`count(*)::int`,
    optedIn: sql<number>`count(*) filter (where marketing_opt_in)::int`,
    returning: sql<number>`count(*) filter (where visits + orders_count >= 2)::int`,
    avgRating: sql<number | null>`round(avg(rating_last)::numeric, 1)`,
  }).from(customersTable).where(eq(customersTable.orgId, t.org.id));
  res.json({ customers: rows.map((c) => ({ ...c, totalSpent: Number(c.totalSpent) })), stats });
}));

router.get("/customers/:phone", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const phone = String(req.params.phone);
  const [c] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, t.org.id), eq(customersTable.phone, phone))).limit(1);
  if (!c) return res.status(404).json({ error: "الزبون غير موجود" });
  const [tickets, orders, bookings] = await Promise.all([
    db.select().from(queueTicketsTable).where(and(eq(queueTicketsTable.orgId, t.org.id), eq(queueTicketsTable.phone, phone))).orderBy(desc(queueTicketsTable.joinedAt)).limit(50),
    db.select().from(ordersTable).where(and(eq(ordersTable.orgId, t.org.id), eq(ordersTable.phone, phone))).orderBy(desc(ordersTable.createdAt)).limit(50),
    db.select().from(bookingsTable).where(and(eq(bookingsTable.orgId, t.org.id), eq(bookingsTable.phone, phone))).orderBy(desc(bookingsTable.startsAt)).limit(50),
  ]);
  res.json({ customer: { ...c, totalSpent: Number(c.totalSpent) }, tickets, orders: orders.map((o) => ({ ...o, subtotal: Number(o.subtotal) })), bookings });
}));

router.patch("/customers/:phone", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const p: Record<string, unknown> = {};
  if (typeof req.body?.name === "string") p.name = req.body.name.trim().slice(0, 80) || null;
  // The owner can withdraw consent on a customer's word; never grant it.
  if (req.body?.marketingOptIn === false) p.marketingOptIn = false;
  const [c] = await db.update(customersTable).set(p).where(and(eq(customersTable.orgId, t.org.id), eq(customersTable.phone, String(req.params.phone)))).returning();
  if (!c) return res.status(404).json({ error: "الزبون غير موجود" });
  res.json(c);
}));

router.get("/customers-export.csv", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const rows = await db.select().from(customersTable).where(eq(customersTable.orgId, t.org.id)).orderBy(desc(customersTable.lastSeenAt));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["phone,name,visits,orders,bookings,no_shows,total_spent,marketing_opt_in,first_seen,last_seen,rating"]
    .concat(rows.map((c) => [c.phone, c.name, c.visits, c.ordersCount, c.bookingsCount, c.noShows, c.totalSpent, c.marketingOptIn, c.firstSeenAt.toISOString(), c.lastSeenAt.toISOString(), c.ratingLast ?? ""].map(esc).join(",")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${t.org.slug}.csv"`);
  res.send("﻿" + lines.join("\n"));
}));

/**
 * The customers who agreed to offers, as a Flow Hub contact list in the
 * current branch's account — the only door from the menu side into a
 * campaign, so a campaign can reach nobody who did not tick «أرسلوا لي العروض».
 * Re-running tops the same list up.
 */
router.post("/customers/to-list", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const { contactGroupsTable } = await import("@workspace/db");
  const { saveToGroup, saveToNewGroup } = await import("../lib/contact-save");
  const rows = await db.select({ phone: customersTable.phone, name: customersTable.name }).from(customersTable)
    .where(and(eq(customersTable.orgId, t.org.id), eq(customersTable.marketingOptIn, true)));
  const entries = rows.filter((r) => !r.phone.includes("@")).map((r) => ({ phone: r.phone, name: r.name }));
  if (!entries.length) return res.status(400).json({ error: "لا يوجد زبائن وافقوا على العروض بعد" });
  const name = `زبائن ${t.org.name} — وافقوا على العروض`;
  const [existing] = await db.select().from(contactGroupsTable).where(and(eq(contactGroupsTable.userId, t.waUserId), eq(contactGroupsTable.name, name))).limit(1);
  const r = existing
    ? await saveToGroup(t.waUserId, existing.id, entries, { allowOtherLists: true })
    : await saveToNewGroup(t.waUserId, name, "من منيو فور يو: كل من وافق على استلام العروض", entries, { allowOtherLists: true });
  res.json({ added: r.added, total: entries.length, groupId: existing?.id ?? r.groups?.[0]?.id ?? null });
}));

// ── WhatsApp templates and what was sent ──────────────────────────

router.get("/wa-templates", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  res.json({ templates: await listTemplates(t.org.id), vars: TEMPLATE_VARS, features: { reviews: !!t.org.features?.reviews, winback: !!t.org.features?.winback } });
}));

router.put("/wa-templates/:key", requireAuth, withTenant(OWNER, async (req, res, t) => {
  try { await saveTemplate(t.org.id, String(req.params.key), req.body ?? {}); }
  catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  res.json({ templates: await listTemplates(t.org.id) });
}));

router.patch("/wa-templates/features", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const f = { ...(t.org.features ?? {}) };
  for (const k of ["reviews", "winback"]) if (typeof req.body?.[k] === "boolean") f[k] = req.body[k];
  const [o] = await db.update(orgsTable).set({ features: f }).where(eq(orgsTable.id, t.org.id)).returning();
  res.json({ features: o!.features });
}));

router.get("/notifications", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  res.json({ recent: await recentNotifications(t.org.id, 150), stats: await notifyStats(t.org.id) });
}));

// ── Reports ───────────────────────────────────────────────────────

router.get("/reports/overview", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const tz = t.org.timezone;
  const today = localDate(tz);
  const since = zonedToUtc(tz, addDays(today, -(days - 1)), "04:00");
  let branchIds = t.role === "owner" ? (await db.select({ id: branchesTable.id }).from(branchesTable).where(eq(branchesTable.orgId, t.org.id))).map((b) => b.id) : t.branchIds;
  // ?branch= narrows every figure, top items included, to one branch.
  const only = Number(req.query.branch);
  if (only && branchIds.includes(only)) branchIds = [only];
  const ids = sql.join(branchIds.map((i) => sql`${i}`), sql`, `);

  const queueDays = await db.execute<any>(sql`
    SELECT service_day AS day, branch_id,
      count(*)::int AS joined,
      count(*) FILTER (WHERE status IN ('done','serving'))::int AS served,
      count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
      count(*) FILTER (WHERE status IN ('left','cancelled'))::int AS left,
      round(avg(extract(epoch FROM (called_at - joined_at)) / 60) FILTER (WHERE called_at IS NOT NULL))::int AS avg_wait,
      round(avg(abs(extract(epoch FROM (called_at - joined_at)) / 60 - eta_at_join_min)) FILTER (WHERE called_at IS NOT NULL AND eta_at_join_min IS NOT NULL)::numeric, 1) AS eta_error,
      round(avg(extract(epoch FROM (called_at - joined_at)) / 60 - eta_at_join_min) FILTER (WHERE called_at IS NOT NULL AND eta_at_join_min IS NOT NULL)::numeric, 1) AS eta_bias,
      count(*) FILTER (WHERE phone_verified)::int AS on_whatsapp
    FROM queue_tickets WHERE org_id = ${t.org.id} AND branch_id IN (${ids}) AND joined_at >= ${since}
    GROUP BY service_day, branch_id ORDER BY service_day`);

  const orderDays = await db.execute<any>(sql`
    SELECT to_char((created_at AT TIME ZONE ${tz}) - interval '4 hours', 'YYYY-MM-DD') AS day, branch_id,
      count(*) FILTER (WHERE status <> 'pending' AND status <> 'cancelled')::int AS orders,
      count(*) FILTER (WHERE status = 'pending')::int AS abandoned,
      coalesce(sum(subtotal) FILTER (WHERE status <> 'pending' AND status <> 'cancelled'), 0)::float AS revenue
    FROM orders WHERE org_id = ${t.org.id} AND branch_id IN (${ids}) AND created_at >= ${since}
    GROUP BY 1, 2 ORDER BY 1`);

  const topItems = await db.execute<any>(sql`
    SELECT (l->>'itemId')::int AS item_id, max(l->>'name') AS name, sum((l->>'qty')::int)::int AS qty, sum((l->>'lineTotal')::numeric)::float AS revenue
    FROM orders, jsonb_array_elements(items) l
    WHERE org_id = ${t.org.id} AND branch_id IN (${ids}) AND created_at >= ${since} AND status NOT IN ('pending', 'cancelled')
    GROUP BY 1 ORDER BY qty DESC LIMIT 10`);

  const bookingDays = await db.execute<any>(sql`
    SELECT to_char(starts_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, branch_id,
      count(*) FILTER (WHERE status NOT IN ('cancelled'))::int AS bookings,
      count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
      count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
    FROM bookings WHERE org_id = ${t.org.id} AND branch_id IN (${ids}) AND starts_at >= ${since}
    GROUP BY 1, 2 ORDER BY 1`);

  const hours = await db.execute<any>(sql`
    SELECT extract(hour FROM joined_at AT TIME ZONE ${tz})::int AS hour, count(*)::int AS joined
    FROM queue_tickets WHERE org_id = ${t.org.id} AND branch_id IN (${ids}) AND joined_at >= ${since}
    GROUP BY 1 ORDER BY 1`);

  const [cust] = await db.select({
    total: sql<number>`count(*)::int`,
    newInRange: sql<number>`count(*) filter (where first_seen_at >= ${since})::int`,
    returning: sql<number>`count(*) filter (where visits + orders_count >= 2)::int`,
    avgRating: sql<number | null>`round(avg(rating_last)::numeric, 1)::float`,
  }).from(customersTable).where(eq(customersTable.orgId, t.org.id));

  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.orgId, t.org.id)).orderBy(asc(branchesTable.sort));
  res.json({ days, since, branches, queue: queueDays.rows, orders: orderDays.rows, bookings: bookingDays.rows, topItems: topItems.rows, byHour: hours.rows, customers: cust });
}));

/** The owner's home: one card per branch, right now. */
router.get("/reports/live", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  const { getStatus } = await import("../lib/whatsapp");
  const { queueCtx, snapshot, etaAt } = await import("../lib/queue/engine");
  const { queuesTable } = await import("@workspace/db");
  const branches = await db.select().from(branchesTable).where(eq(branchesTable.orgId, t.org.id)).orderBy(asc(branchesTable.sort), asc(branchesTable.id));
  const visible = branches.filter((b) => t.role === "owner" || t.branchIds.includes(b.id));
  const out = [];
  for (const b of visible) {
    const qs = await db.select().from(queuesTable).where(and(eq(queuesTable.branchId, b.id), eq(queuesTable.isActive, true)));
    let waiting = 0, served = 0, noShows = 0, avgWait: number | null = null, eta = null as any;
    for (const q of qs) {
      const ctx = await queueCtx(q.id);
      if (!ctx) continue;
      const s = await snapshot(ctx);
      waiting += s.waiting.length; served += s.servedToday; noShows += s.noShowsToday;
      avgWait = s.avgWaitToday ?? avgWait;
      eta = eta ?? etaAt(s, s.waiting.length);
    }
    const dayStart = zonedToUtc(t.org.timezone, localDate(t.org.timezone, new Date(Date.now() - 4 * 3_600_000)), "04:00");
    const [o] = await db.select({
      n: sql<number>`count(*) filter (where status not in ('pending','cancelled'))::int`,
      open: sql<number>`count(*) filter (where status in ('received','preparing','ready'))::int`,
      revenue: sql<number>`coalesce(sum(subtotal) filter (where status not in ('pending','cancelled')), 0)::float`,
    }).from(ordersTable).where(and(eq(ordersTable.branchId, b.id), gte(ordersTable.createdAt, dayStart)));
    const [bk] = await db.select({ n: sql<number>`count(*)::int` }).from(bookingsTable)
      .where(and(eq(bookingsTable.branchId, b.id), gte(bookingsTable.startsAt, dayStart), sql`${bookingsTable.startsAt} < ${new Date(dayStart.getTime() + 24 * 3_600_000)}`, sql`${bookingsTable.status} not in ('cancelled')`));
    const wa = getStatus(b.waUserId) as { connected?: boolean; phone?: string };
    out.push({
      id: b.id, name: b.name, isActive: b.isActive, waiting, served, noShows, avgWait, eta,
      orders: o?.n ?? 0, openOrders: o?.open ?? 0, revenue: o?.revenue ?? 0, bookingsToday: bk?.n ?? 0,
      wa: { connected: !!wa?.connected, phone: wa?.phone ?? null },
      noShowRate: served + noShows ? Math.round((noShows / (served + noShows)) * 100) : null,
    });
  }
  res.json({ branches: out, currency: t.org.currency, plan: await menuPlan(t.org.ownerUserId) });
}));

// ── QR codes and the print kit ────────────────────────────────────

router.get("/qr/image", requireAuth, async (req, res) => {
  const text = String(req.query.text ?? "");
  if (!text || text.length > 600) return res.status(400).json({ error: "نص غير صالح" });
  const fmt = req.query.format === "svg" ? "svg" : "png";
  const size = Math.max(128, Math.min(2048, Number(req.query.size) || 512));
  const dark = /^#[0-9a-f]{6}$/i.test(String(req.query.dark)) ? String(req.query.dark) : "#111111";
  const opts = { errorCorrectionLevel: "M" as const, margin: 1, width: size, color: { dark, light: "#ffffff" } };
  if (fmt === "svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.send(await QRCode.toString(text, { ...opts, type: "svg" }));
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(await QRCode.toBuffer(text, opts));
});

router.get("/qr/kit", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const tables = Math.max(0, Math.min(200, Number(req.query.tables) || 0));
  const menu = publicUrl(menuPath(t.org.slug, t.branch.slug));
  res.json({
    org: { name: t.org.name, nameEn: t.org.nameEn, logoUrl: t.org.logoUrl, theme: t.org.theme, vertical: t.org.vertical, slug: t.org.slug },
    branch: { id: t.branch.id, name: t.branch.name, nameEn: t.branch.nameEn, slug: t.branch.slug },
    menu,
    queue: `${menu}?src=qr#queue`,
    book: `${menu}?book=1`,
    display: publicUrl(displayPath(t.branch.displayToken)),
    tables: Array.from({ length: tables }, (_, i) => ({ label: String(i + 1), url: `${menu}?t=${i + 1}` })),
  });
}));

export default router;
