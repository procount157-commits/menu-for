// ── /api/admin/orgs — the platform owner's view of every shop ─────

import { Router } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, orgsTable, branchesTable, usersTable, PLAN_LIMITS } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { attachOwner, TenantError } from "../lib/tenancy/context";
import { createOrg } from "../lib/tenancy/org";
import { getStatus } from "../lib/whatsapp";
import { publicUrl, menuPath } from "../lib/menu/urls";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const { rows } = await db.execute<any>(sql`
    SELECT o.id, o.name, o.slug, o.vertical, o.status, o.created_at, o.onboarded_at, o.features,
      u.id AS owner_id, u.phone AS owner_phone, u.display_name AS owner_name, u.plan, u.plan_expires_at, u.last_login_at,
      (SELECT count(*)::int FROM branches b WHERE b.org_id = o.id) AS branches,
      (SELECT count(*)::int FROM menu_items i WHERE i.org_id = o.id) AS items,
      (SELECT count(*)::int FROM staff s WHERE s.org_id = o.id) AS staff,
      (SELECT count(*)::int FROM queue_tickets t WHERE t.org_id = o.id AND t.joined_at > now() - interval '7 days') AS tickets_7d,
      (SELECT count(*)::int FROM orders r WHERE r.org_id = o.id AND r.created_at > now() - interval '7 days' AND r.status NOT IN ('pending','cancelled')) AS orders_7d,
      (SELECT count(*)::int FROM bookings k WHERE k.org_id = o.id AND k.created_at > now() - interval '7 days') AS bookings_7d,
      (SELECT count(*)::int FROM customers c WHERE c.org_id = o.id) AS customers,
      (SELECT count(*)::int FROM notifications n WHERE n.org_id = o.id AND n.status = 'sent' AND n.sent_at > now() - interval '7 days') AS sent_7d
    FROM orgs o JOIN users u ON u.id = o.owner_user_id
    ORDER BY o.created_at DESC`);
  const branches = await db.select({ orgId: branchesTable.orgId, waUserId: branchesTable.waUserId }).from(branchesTable);
  const waByOrg = new Map<number, { linked: number; total: number }>();
  for (const b of branches) {
    const w = waByOrg.get(b.orgId) ?? { linked: 0, total: 0 };
    w.total++;
    if ((getStatus(b.waUserId) as { connected?: boolean })?.connected) w.linked++;
    waByOrg.set(b.orgId, w);
  }
  res.json(rows.map((r: any) => ({ ...r, wa: waByOrg.get(r.id) ?? { linked: 0, total: 0 }, menuUrl: publicUrl(menuPath(r.slug)) })));
});

/**
 * Create a shop for a customer: the owner's account and the shop in one step,
 * on the plan that was sold. The owner signs in with the phone and password
 * given here and lands in a shop that already exists.
 */
router.post("/", async (req, res) => {
  const b = req.body ?? {};
  const phone = String(b.ownerPhone ?? "").replace(/[\s\-+()]/g, "").replace(/^00/, "");
  if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: "رقم جوال صاحب المحل غير صالح" });
  if (String(b.password ?? "").length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل" });
  if (String(b.name ?? "").trim().length < 2) return res.status(400).json({ error: "اكتب اسم المحل" });
  const [dup] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (dup) return res.status(409).json({ error: "هذا الرقم مسجّل مسبقاً — ابحث عن محله في القائمة" });
  const plan = typeof b.plan === "string" && b.plan in PLAN_LIMITS ? b.plan : "free";
  const days = Number(b.planDays);
  const [user] = await db.insert(usersTable).values({
    phone, passwordHash: await bcrypt.hash(String(b.password), 10),
    displayName: String(b.ownerName ?? "").trim() || null, isAdmin: false, status: "active",
    plan, planExpiresAt: days > 0 ? new Date(Date.now() + days * 24 * 3_600_000) : null,
    connectToken: randomUUID(),
  }).returning();
  try {
    const { org, branch } = await createOrg(user!.id, {
      name: b.name, nameEn: b.nameEn, vertical: b.vertical, slug: b.slug || undefined,
      address: b.address, displayPhone: b.displayPhone,
    });
    await db.update(orgsTable).set({ onboardedAt: new Date() }).where(eq(orgsTable.id, org.id));
    logger.info({ orgId: org.id, ownerId: user!.id, plan }, "admin created shop");
    res.status(201).json({ org, branchId: branch.id, ownerPhone: phone, menuUrl: publicUrl(menuPath(org.slug)), loginUrl: publicUrl("/login") });
  } catch (err) {
    // No half-made account: the owner row goes if the shop could not be made.
    await db.delete(usersTable).where(eq(usersTable.id, user!.id));
    if (err instanceof TenantError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.get("/platform/stats", async (_req, res) => {
  const [s] = (await db.execute<any>(sql`
    SELECT
      (SELECT count(*)::int FROM orgs) AS orgs,
      (SELECT count(*)::int FROM orgs WHERE status = 'active') AS active_orgs,
      (SELECT count(*)::int FROM branches) AS branches,
      (SELECT count(*)::int FROM queue_tickets WHERE joined_at > now() - interval '24 hours') AS tickets_24h,
      (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '24 hours' AND status NOT IN ('pending','cancelled')) AS orders_24h,
      (SELECT count(*)::int FROM bookings WHERE created_at > now() - interval '24 hours') AS bookings_24h,
      (SELECT count(*)::int FROM notifications WHERE status = 'sent' AND sent_at > now() - interval '24 hours') AS sent_24h,
      (SELECT count(*)::int FROM notifications WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
      (SELECT count(*)::int FROM customers) AS customers
  `)).rows;
  const plans = await db.select({ plan: usersTable.plan, n: sql<number>`count(*)::int` }).from(usersTable)
    .innerJoin(orgsTable, eq(orgsTable.ownerUserId, usersTable.id)).groupBy(usersTable.plan);
  res.json({ ...s, plans, planNames: Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.name])) });
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, id)).limit(1);
  if (!o) return res.status(404).json({ error: "المحل غير موجود" });
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (b.status === "active" || b.status === "suspended") patch.status = b.status;
  if (b.features && typeof b.features === "object") patch.features = { ...(o.features ?? {}), ...Object.fromEntries(Object.entries(b.features).filter(([, v]) => typeof v === "boolean")) };
  if (Object.keys(patch).length) await db.update(orgsTable).set(patch).where(eq(orgsTable.id, id));
  const up: Record<string, unknown> = {};
  if (typeof b.plan === "string" && b.plan in PLAN_LIMITS) up.plan = b.plan;
  if (b.planDays !== undefined) {
    const d = Number(b.planDays);
    up.planExpiresAt = d > 0 ? new Date(Date.now() + d * 24 * 3_600_000) : null;
  }
  if (Object.keys(up).length) await db.update(usersTable).set(up).where(eq(usersTable.id, o.ownerUserId));
  logger.info({ orgId: id, patch, up }, "admin updated org");
  res.json({ ok: true });
});

/** See the shop exactly as its owner does. «رجوع» in the app ends it. */
router.post("/:id/login-as", async (req, res) => {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, Number(req.params.id))).limit(1);
  if (!o) return res.status(404).json({ error: "المحل غير موجود" });
  const adminId = req.session.ownerId ?? req.session.userId!;
  req.session.impersonatorId = adminId;
  req.session.isAdmin = false;
  req.session.userId = o.ownerUserId;
  delete req.session.orgId; delete req.session.branchId;
  await attachOwner(req, o.ownerUserId);
  logger.info({ adminId, orgId: o.id }, "admin viewing shop as owner");
  res.json({ ok: true });
});

export default router;
