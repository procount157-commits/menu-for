import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, contactGroupsTable, campaignsTable, couponsTable } from "@workspace/db";
import { eq, desc, count, sql, and, or, isNull, gt, ne } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";
import { logout as waLogout } from "../lib/whatsapp";
import { readSettings, writeSettings } from "../lib/settings";

const router = Router();
router.use(requireAdmin);

// ── Site settings (admin-only) ─────────────────────────────────────
router.get("/settings", (_req, res) => {
  res.json(readSettings());
});

router.post("/settings", (req, res) => {
  const allowed = ["whatsappNumber", "salesWhatsapp", "supportWhatsapp", "heroTitleAr", "heroTitleEn", "heroSubAr", "heroSubEn"];
  const updates: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof req.body[key] === "string") updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "لا توجد تحديثات صالحة" });
  }
  const result = writeSettings(updates as any);
  logger.info({ updates: Object.keys(updates) }, "Admin updated site settings");
  res.json({ success: true, settings: result });
});

// ── List all users with plan info + stats ─────────────────────────
router.get("/users", async (req, res) => {
  const users = await db
    .select({
      id:            usersTable.id,
      phone:         usersTable.phone,
      displayName:   usersTable.displayName,
      isAdmin:       usersTable.isAdmin,
      status:        usersTable.status,
      createdAt:     usersTable.createdAt,
      lastLoginAt:   usersTable.lastLoginAt,
      plan:          usersTable.plan,
      planExpiresAt: usersTable.planExpiresAt,
      monthlyPrice:  usersTable.monthlyPrice,
      notes:         usersTable.notes,
      qrDisabled:        usersTable.qrDisabled,
      connectToken:      usersTable.connectToken,
      directLoginToken:  usersTable.directLoginToken,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  const enriched = await Promise.all(
    users.map(async (u) => {
      let { connectToken } = u;
      if (!connectToken) {
        connectToken = randomUUID();
        await db.update(usersTable).set({ connectToken }).where(eq(usersTable.id, u.id));
      }

      const [grpCount] = await db
        .select({ count: count(contactGroupsTable.id) })
        .from(contactGroupsTable)
        .where(eq(contactGroupsTable.userId, u.id));

      const [campCount] = await db
        .select({ count: count(campaignsTable.id) })
        .from(campaignsTable)
        .where(eq(campaignsTable.userId, u.id));

      return { ...u, connectToken, contactGroupsCount: grpCount.count, campaignsCount: campCount.count };
    })
  );

  res.json(enriched);
});

// ── Get single user ───────────────────────────────────────────────
router.get("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const { passwordHash: _ph, ...safe } = user;
  res.json(safe);
});

// ── Create user ───────────────────────────────────────────────────
router.post("/users", async (req, res) => {
  const { phone, password, displayName, isAdmin = false, plan = "free", monthlyPrice = 0 } = req.body;
  if (!phone || !password) return res.status(400).json({ error: "رقم الهاتف وكلمة المرور مطلوبان" });

  const cleanPhone   = String(phone).replace(/[\s\-\+\(\)]/g, "").replace(/^00/, "");
  const passwordHash = await bcrypt.hash(String(password), 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      phone: cleanPhone, passwordHash,
      displayName: displayName || null,
      isAdmin: Boolean(isAdmin),
      status: "active",
      plan,
      monthlyPrice: String(monthlyPrice),
      connectToken: randomUUID(),
    })
    .returning();

  const { passwordHash: _ph, ...safe } = user;
  logger.info({ adminId: req.session.userId, newUserId: user.id }, "Admin created user");
  res.status(201).json(safe);
});

// ── Update user ───────────────────────────────────────────────────
router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, any> = {};

  if (req.body.status        !== undefined) updates.status        = req.body.status;
  if (req.body.displayName   !== undefined) updates.displayName   = req.body.displayName;
  if (req.body.isAdmin       !== undefined) updates.isAdmin       = Boolean(req.body.isAdmin);
  if (req.body.plan          !== undefined) updates.plan          = req.body.plan;
  if (req.body.monthlyPrice  !== undefined) updates.monthlyPrice  = String(req.body.monthlyPrice);
  if (req.body.notes         !== undefined) updates.notes         = req.body.notes || null;
  if ("planExpiresAt" in req.body) {
    updates.planExpiresAt = req.body.planExpiresAt ? new Date(req.body.planExpiresAt) : null;
  }
  if ("dailyMessageLimit" in req.body) {
    updates.dailyMessageLimit = req.body.dailyMessageLimit ? parseInt(req.body.dailyMessageLimit) : null;
  }
  if ("qrDisabled" in req.body) updates.qrDisabled = Boolean(req.body.qrDisabled);
  if (req.body.password) updates.passwordHash = await bcrypt.hash(String(req.body.password), 10);

  if (!Object.keys(updates).length) return res.status(400).json({ error: "لا توجد تحديثات" });

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const { passwordHash: _ph, ...safe } = user;
  logger.info({ adminId: req.session.userId, targetId: id, updates: Object.keys(updates) }, "Admin updated user");
  res.json(safe);
});

// ── Regenerate public connect token ───────────────────────────────
router.post("/users/:id/regenerate-token", async (req, res) => {
  const id           = parseInt(req.params.id);
  const connectToken = randomUUID();
  await db.update(usersTable).set({ connectToken }).where(eq(usersTable.id, id));
  logger.info({ adminId: req.session.userId, targetId: id }, "Regenerated connect token");
  res.json({ connectToken });
});

// ── Delete user ───────────────────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" });
  await db.delete(usersTable).where(eq(usersTable.id, id));
  logger.info({ adminId: req.session.userId, deletedId: id }, "Admin deleted user");
  res.json({ success: true });
});

// ── Stats + revenue ───────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const [userCount]   = await db.select({ count: count(usersTable.id) }).from(usersTable);
  const [activeCount] = await db.select({ count: count(usersTable.id) }).from(usersTable).where(eq(usersTable.status, "active"));
  const [campCount]   = await db.select({ count: count(campaignsTable.id) }).from(campaignsTable);
  const [totalSent]   = await db.select({ total: sql<number>`coalesce(sum(${campaignsTable.sentCount}), 0)` }).from(campaignsTable);

  const [revenueRow] = await db
    .select({ total: sql<number>`coalesce(sum(cast(${usersTable.monthlyPrice} as numeric)), 0)` })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.status, "active"),
        ne(usersTable.plan, "free"),
        or(isNull(usersTable.planExpiresAt), gt(usersTable.planExpiresAt, new Date()))
      )
    );

  const planRows = await db
    .select({ plan: usersTable.plan, count: count(usersTable.id) })
    .from(usersTable)
    .groupBy(usersTable.plan);

  res.json({
    totalUsers:        userCount.count,
    activeUsers:       activeCount.count,
    totalCampaigns:    campCount.count,
    totalMessagesSent: Number(totalSent.total),
    monthlyRevenue:    Number(revenueRow.total),
    planCounts:        Object.fromEntries(planRows.map((r) => [r.plan, r.count])),
  });
});

// ── Toggle QR disabled per user ────────────────────────────────────
router.post("/users/:id/toggle-qr", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.select({ qrDisabled: usersTable.qrDisabled }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const newVal = !user.qrDisabled;
  await db.update(usersTable).set({ qrDisabled: newVal }).where(eq(usersTable.id, id));
  logger.info({ adminId: req.session.userId, targetId: id, qrDisabled: newVal }, "Admin toggled QR");
  res.json({ qrDisabled: newVal });
});

// ── Force restart WhatsApp session ────────────────────────────────
router.post("/users/:id/restart-wa", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  try { await waLogout(user.id); } catch { /* already disconnected */ }
  await db.update(usersTable).set({ currentQr: null, qrExpiresAt: null }).where(eq(usersTable.id, id));
  logger.info({ adminId: req.session.userId, targetId: id }, "Admin force-restarted WA session");
  res.json({ success: true });
});

// ── Coupons CRUD ──────────────────────────────────────────────────
router.get("/coupons", async (req, res) => {
  const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
  res.json(coupons);
});

router.post("/coupons", async (req, res) => {
  const { label, type = "days", planUpgrade, daysAdded = 30, maxUses = 1, expiresAt } = req.body;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  const [coupon] = await db.insert(couponsTable).values({
    code,
    label: label || null,
    type,
    planUpgrade: planUpgrade || null,
    daysAdded: Number(daysAdded),
    maxUses: Number(maxUses),
    createdBy: req.session.userId,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning();
  logger.info({ adminId: req.session.userId, couponId: coupon.id, code }, "Admin created coupon");
  res.status(201).json(coupon);
});

router.delete("/coupons/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(couponsTable).where(eq(couponsTable.id, id));
  logger.info({ adminId: req.session.userId, couponId: id }, "Admin deleted coupon");
  res.json({ success: true });
});

export default router;
