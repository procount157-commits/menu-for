// ── /api/deals — coupons and timed deals, as the owner runs them ──

import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, shopDealsTable, ordersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, MANAGERS } from "../lib/tenancy/context";
import { menuPlan } from "../lib/plans";
import { cleanDeal, toDeal, dealStatus } from "../lib/growth/deals";

const router = Router();

router.get("/deals", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  const rows = await db.select().from(shopDealsTable).where(eq(shopDealsTable.orgId, t.org.id)).orderBy(desc(shopDealsTable.id)).limit(300);
  // What each deal has taken off, from the orders that used it.
  const usage = await db.select({ id: ordersTable.dealId, n: sql<number>`count(*)::int`, off: sql<number>`coalesce(sum(discount), 0)::float`, sales: sql<number>`coalesce(sum(subtotal - discount), 0)::float` })
    .from(ordersTable).where(and(eq(ordersTable.orgId, t.org.id), sql`${ordersTable.dealId} IS NOT NULL`, sql`${ordersTable.status} NOT IN ('pending','cancelled')`)).groupBy(ordersTable.dealId);
  const by = new Map(usage.map((u) => [u.id, u]));
  const plan = await menuPlan(t.org.ownerUserId);
  res.json({
    allowed: plan.features.marketing, planName: plan.planName,
    deals: rows.map((r) => {
      const d = toDeal(r);
      const u = by.get(r.id);
      return { ...d, status: dealStatus(d, t.org.timezone), orders: u?.n ?? 0, discountGiven: u?.off ?? 0, sales: u?.sales ?? 0 };
    }),
  });
}));

router.post("/deals", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const plan = await menuPlan(t.org.ownerUserId);
  if (!plan.features.marketing) return res.status(402).json({ error: `الكوبونات والعروض بالساعات من خطة «احترافي» — خطتك ${plan.planName}.`, plan: true });
  const c = cleanDeal(req.body);
  if (!c.ok) return res.status(400).json({ error: c.error });
  const [row] = await db.insert(shopDealsTable).values({ ...c.row, orgId: t.org.id, source: "owner" } as any).onConflictDoNothing().returning();
  if (!row) return res.status(409).json({ error: "هذا الكود مستخدم في عرض آخر" });
  res.status(201).json(toDeal(row));
}));

router.patch("/deals/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const id = Number(req.params.id);
  const [cur] = await db.select().from(shopDealsTable).where(and(eq(shopDealsTable.id, id), eq(shopDealsTable.orgId, t.org.id))).limit(1);
  if (!cur) return res.status(404).json({ error: "العرض غير موجود" });
  // A switch on its own, or the whole form again.
  if (Object.keys(req.body ?? {}).length === 1 && typeof req.body.isActive === "boolean") {
    await db.update(shopDealsTable).set({ isActive: req.body.isActive }).where(eq(shopDealsTable.id, id));
    return res.json({ ok: true });
  }
  const c = cleanDeal({ ...toDeal(cur), ...req.body });
  if (!c.ok) return res.status(400).json({ error: c.error });
  try { await db.update(shopDealsTable).set(c.row as any).where(eq(shopDealsTable.id, id)); }
  catch { return res.status(409).json({ error: "هذا الكود مستخدم في عرض آخر" }); }
  res.json({ ok: true });
}));

router.delete("/deals/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  await db.delete(shopDealsTable).where(and(eq(shopDealsTable.id, Number(req.params.id)), eq(shopDealsTable.orgId, t.org.id)));
  res.json({ ok: true });
}));

export default router;
