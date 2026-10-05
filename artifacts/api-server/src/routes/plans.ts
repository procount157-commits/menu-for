import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { pool, db, subscriptionPlansTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { LIMITS, TOGGLES, DEFAULT_PLANS, bulletsFor } from "@workspace/menu-shared";
import { loadPlans, invalidatePlans, trialSettings } from "../lib/plans";

const router = Router();

// ── Public ────────────────────────────────────────────────────────
// GET /api/plans — the public plans, with bullets written from the matrix when the owner wrote none.
router.get("/", async (_req, res) => {
  const plans = [...(await loadPlans()).values()].filter((p) => p.isActive && p.isPublic && p.key !== "trial").sort((a, b) => a.sort - b.sort);
  const trial = await trialSettings();
  return res.json(plans.map((p) => ({
    id: p.key, plan_key: p.key, name: p.name, name_en: p.nameEn, price: String(p.priceMonthly), price_yearly: p.priceYearly == null ? null : String(p.priceYearly),
    extra_branch_price: p.extraBranchPrice, contact_sales: p.contactSales, period: "monthly", period_label: "درهم / شهر",
    features: p.bullets.length ? p.bullets : bulletsFor(p, "ar"), features_en: p.bulletsEn.length ? p.bulletsEn : bulletsFor(p, "en"),
    badge: p.badge, badge_en: p.badgeEn, is_featured: p.isFeatured, sort_order: p.sort,
    limits: p.limits, toggles: p.toggles, trial_days: trial.days,
  })));
});

// The old shape, kept for anything that still reads it.
router.get("/legacy", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, name_en, price, period, period_label,
           description, description_en, features, features_en,
           badge, badge_en, is_featured, sort_order, plan_key
    FROM subscription_plans
    WHERE is_active = true
    ORDER BY sort_order ASC, id ASC
  `);
  res.json(rows);
});

// ── Admin CRUD ────────────────────────────────────────────────────
router.use("/admin", requireAuth, requireAdmin as any);

// GET /api/plans/admin — all plans
router.get("/admin", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC`
  );
  res.json(rows);
});

// POST /api/plans/admin — create plan
router.post("/admin", async (req, res) => {
  const { name, name_en, price, period, period_label, description, description_en,
          features, features_en, badge, badge_en, is_active, is_featured, sort_order } = req.body;
  if (!name || !price || !period) {
    return res.status(400).json({ error: "name, price, period required" });
  }
  const { rows } = await pool.query(
    `INSERT INTO subscription_plans
       (name, name_en, price, period, period_label, description, description_en,
        features, features_en, badge, badge_en, is_active, is_featured, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [name, name_en, price, period, period_label,
     description, description_en,
     JSON.stringify(features ?? []), JSON.stringify(features_en ?? []),
     badge || null, badge_en || null,
     is_active !== false, !!is_featured, sort_order ?? 0]
  );
  invalidatePlans();
  logger.info({ planId: rows[0].id, name }, "Admin created subscription plan");
  res.status(201).json(rows[0]);
});

// PUT /api/plans/admin/:id — update plan
router.put("/admin/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, name_en, price, period, period_label, description, description_en,
          features, features_en, badge, badge_en, is_active, is_featured, sort_order } = req.body;

  const { rows } = await pool.query(
    `UPDATE subscription_plans
     SET name=$1, name_en=$2, price=$3, period=$4, period_label=$5,
         description=$6, description_en=$7,
         features=$8, features_en=$9,
         badge=$10, badge_en=$11,
         is_active=$12, is_featured=$13, sort_order=$14
     WHERE id=$15
     RETURNING *`,
    [name, name_en, price, period, period_label,
     description, description_en,
     JSON.stringify(features ?? []), JSON.stringify(features_en ?? []),
     badge || null, badge_en || null,
     is_active !== false, !!is_featured, sort_order ?? 0, id]
  );
  if (!rows.length) return res.status(404).json({ error: "Plan not found" });
  invalidatePlans();
  logger.info({ planId: id }, "Admin updated subscription plan");
  res.json(rows[0]);
});

// ── The matrix ────────────────────────────────────────────────────

/** Every plan in full, the rows of the matrix, and how many shops are on each. */
router.get("/admin/matrix", async (_req, res) => {
  invalidatePlans();
  const plans = [...(await loadPlans()).values()].sort((a, b) => a.sort - b.sort);
  const counts = await db.select({ plan: usersTable.plan, n: sql<number>`count(*)::int` }).from(usersTable).where(sql`${usersTable.orgId} IS NOT NULL OR ${usersTable.id} IN (SELECT owner_user_id FROM orgs)`).groupBy(usersTable.plan);
  const ids = await db.select({ id: subscriptionPlansTable.id, key: subscriptionPlansTable.planKey }).from(subscriptionPlansTable).where(isNotNull(subscriptionPlansTable.planKey));
  const idOf = new Map(ids.map((r) => [r.key!, r.id]));
  res.json({
    rows: { limits: LIMITS, toggles: TOGGLES },
    plans: plans.map((p) => ({ ...p, id: idOf.get(p.key) ?? null, shops: counts.find((c) => c.plan === p.key)?.n ?? 0, autoBullets: bulletsFor(p, "ar") })),
    trial: await trialSettings(),
  });
});

/** Any cell: a price, a switch, a limit, a name, visibility. Missing keys are left as they are. */
router.put("/admin/matrix/:key", async (req, res) => {
  const key = String(req.params.key);
  const b = req.body ?? {};
  const [row] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.planKey, key)).limit(1);
  if (!row) return res.status(404).json({ error: "الخطة غير موجودة" });
  const num = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 120);
  if ("nameEn" in b) patch.nameEn = String(b.nameEn ?? "").trim().slice(0, 120) || null;
  if ("priceMonthly" in b && num(b.priceMonthly) != null) patch.price = String(Math.max(0, num(b.priceMonthly)!));
  if ("priceYearly" in b) patch.priceYearly = num(b.priceYearly) == null ? null : String(Math.max(0, num(b.priceYearly)!));
  if ("extraBranchPrice" in b) patch.extraBranchPrice = num(b.extraBranchPrice) == null ? null : String(Math.max(0, num(b.extraBranchPrice)!));
  for (const k of ["contactSales", "isPublic", "isActive", "isFeatured"] as const) if (typeof b[k] === "boolean") patch[k] = b[k];
  if ("badge" in b) patch.badge = String(b.badge ?? "").trim().slice(0, 60) || null;
  if ("badgeEn" in b) patch.badgeEn = String(b.badgeEn ?? "").trim().slice(0, 60) || null;
  if (Number.isInteger(b.sort)) patch.sortOrder = b.sort;
  if (Array.isArray(b.bullets)) patch.features = b.bullets.map((x: unknown) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 20);
  if (Array.isArray(b.bulletsEn)) patch.featuresEn = b.bulletsEn.map((x: unknown) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 20);
  if (b.limits && typeof b.limits === "object") {
    const next = { ...(row.limits ?? {}) } as Record<string, number>;
    for (const l of LIMITS) { const v = b.limits[l.key]; if (v === undefined) continue; const n = num(v); if (n != null) next[l.key] = n < 0 ? -1 : Math.round(n); }
    patch.limits = next;
  }
  if (b.toggles && typeof b.toggles === "object") {
    const next = { ...(row.toggles ?? {}) } as Record<string, boolean>;
    for (const t of TOGGLES) { const v = b.toggles[t.key]; if (typeof v === "boolean") next[t.key] = v; }
    patch.toggles = next;
  }
  if (Object.keys(patch).length) await db.update(subscriptionPlansTable).set(patch).where(eq(subscriptionPlansTable.id, row.id));
  invalidatePlans();
  logger.info({ key, patch: Object.keys(patch) }, "admin edited plan matrix");
  res.json({ ok: true });
});

/** A new plan: a key, a name, a price — it starts as a copy of the plan named in `from`. */
router.post("/admin/matrix", async (req, res) => {
  const b = req.body ?? {};
  const key = String(b.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  if (key.length < 2) return res.status(400).json({ error: "مفتاح الخطة: حروف إنجليزية صغيرة وأرقام (مثل starter)" });
  if (!String(b.name ?? "").trim()) return res.status(400).json({ error: "اكتب اسم الخطة" });
  if ((await loadPlans()).has(key)) return res.status(409).json({ error: "هذا المفتاح مستخدم" });
  const from = (await loadPlans()).get(String(b.from ?? "")) ?? (await loadPlans()).get("basic");
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(subscriptionPlansTable);
  await db.insert(subscriptionPlansTable).values({
    name: String(b.name).trim().slice(0, 120), nameEn: String(b.nameEn ?? "").trim().slice(0, 120) || null, price: String(Math.max(0, Number(b.priceMonthly) || 0)),
    period: "monthly", periodLabel: "درهم / شهر", features: [], featuresEn: [], isActive: true, isPublic: b.isPublic !== false, isFeatured: false,
    sortOrder: count?.n ?? 0, planKey: key, limits: { ...(from?.limits ?? DEFAULT_PLANS["basic"]!.limits) }, toggles: { ...(from?.toggles ?? DEFAULT_PLANS["basic"]!.toggles) },
  });
  invalidatePlans();
  res.status(201).json({ ok: true, key });
});

/** Delete a plan nobody is on; built-in keys stay. */
router.delete("/admin/matrix/:key", async (req, res) => {
  const key = String(req.params.key);
  if (key in DEFAULT_PLANS) return res.status(400).json({ error: "هذه خطة أساسية — أوقفها أو أخفِها بدل حذفها" });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.plan, key));
  if (n) return res.status(409).json({ error: `${n} محل على هذه الخطة — انقلهم أولاً` });
  await db.delete(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.planKey, key)));
  invalidatePlans();
  res.json({ ok: true });
});

// PATCH /api/plans/admin/:id/toggle — toggle is_active
router.patch("/admin/:id/toggle", async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query(
    `UPDATE subscription_plans SET is_active = NOT is_active WHERE id=$1 RETURNING *`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: "Plan not found" });
  res.json(rows[0]);
});

// DELETE /api/plans/admin/:id — delete plan
router.delete("/admin/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await pool.query(`DELETE FROM subscription_plans WHERE id=$1`, [id]);
  logger.info({ planId: id }, "Admin deleted subscription plan");
  res.json({ success: true });
});

export default router;
