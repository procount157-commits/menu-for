import { Router } from "express";
import { randomUUID } from "crypto";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { checkCoupon, redeemCoupon, CouponError } from "../lib/coupons";
import { attachOwner, signedInUser } from "../lib/tenancy/context";
import { staffTable } from "@workspace/db";

const router = Router();

// Register
// Registration is by invitation. This is sold to a known handful of
// companies, each handed a code by the owner; an open form would let anyone
// on the internet link a WhatsApp number to this server and get it banned
// on the same IP as the paying tenants. OPEN_REGISTRATION=true opens it.
router.post("/register", async (req, res) => {
  const { phone, password, displayName, code } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: "رقم الهاتف وكلمة المرور مطلوبان" });
  }

  const open = process.env["OPEN_REGISTRATION"] === "true";
  if (!open) {
    if (!code || typeof code !== "string") {
      return res.status(403).json({ error: "التسجيل بدعوة — أدخل كود الدعوة الذي وصلك", inviteRequired: true });
    }
    try { await checkCoupon(code); }
    catch (err) {
      if (err instanceof CouponError) return res.status(err.status).json({ error: err.message, inviteRequired: true });
      throw err;
    }
  }

  const cleanPhone = String(phone).replace(/[\s\-\+\(\)]/g, "").replace(/^00/, "");
  if (!/^\d{7,15}$/.test(cleanPhone)) {
    return res.status(400).json({ error: "رقم الهاتف غير صالح" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, cleanPhone));
  if (existing.length > 0) {
    return res.status(409).json({ error: "هذا الرقم مسجّل مسبقاً" });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const [user] = await db.insert(usersTable).values({
    phone: cleanPhone,
    passwordHash,
    displayName: displayName ? String(displayName).trim() : null,
    isAdmin: false,
    status: "active",
    connectToken: randomUUID(),
  }).returning();

  req.session.userId = user.id;
  req.session.isAdmin = user.isAdmin;
  await attachOwner(req, user.id);

  // The invitation is also the plan: a code carries the days and the tier
  // the owner sold, so a new account starts on what was agreed.
  if (!open && typeof code === "string") {
    await redeemCoupon(user.id, code).catch((err) =>
      logger.warn({ userId: user.id, err: String(err?.message ?? err) }, "invite code could not be redeemed after sign-up"));
  }

  logger.info({ userId: user.id, phone: cleanPhone, invited: !open }, "New user registered");

  res.status(201).json({
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    status: user.status,
  });
});

// Login
router.post("/login", async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: "رقم الهاتف وكلمة المرور مطلوبان" });
  }

  const rawPhone   = String(phone).replace(/[\s\-\+\(\)]/g, "");
  const cleanPhone = rawPhone.replace(/^00/, "");

  // Try cleaned version first, then fall back to raw input (handles special accounts like 00000000)
  let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, cleanPhone));
  if (!user && cleanPhone !== rawPhone) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.phone, rawPhone));
  }
  if (!user) {
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }

  if (user.status === "suspended") {
    return res.status(403).json({ error: "هذا الحساب موقوف. تواصل مع المدير." });
  }
  // A branch's own-number account holds a WhatsApp session, not a person.
  if (user.kind === "branch") {
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }

  await new Promise<void>((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
  req.session.userId = user.id;
  req.session.isAdmin = user.isAdmin;
  await attachOwner(req, user.id);

  // Track last login time
  db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id)).catch(() => {});

  logger.info({ userId: user.id }, "User logged in");

  res.json({
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    status: user.status,
  });
});

// Logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

// Direct login via token (password-free admin access link)
router.get("/direct/:token", async (req, res) => {
  const { token } = req.params;
  if (!token || token.length < 32) return res.status(400).json({ error: "رابط غير صالح" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.directLoginToken, token));
  if (!user) return res.status(404).json({ error: "الرابط غير صحيح أو منتهي الصلاحية" });
  if (user.status === "suspended") return res.status(403).json({ error: "هذا الحساب موقوف" });

  if (user.kind === "branch") return res.status(404).json({ error: "الرابط غير صحيح أو منتهي الصلاحية" });
  req.session.userId  = user.id;
  req.session.isAdmin = user.isAdmin;
  await attachOwner(req, user.id);

  logger.info({ userId: user.id }, "Direct token login");

  res.json({ id: user.id, phone: user.phone, displayName: user.displayName, isAdmin: user.isAdmin, status: user.status });
});

// Regenerate direct login token for a user (admin only or self)
router.post("/direct/regenerate/:userId", requireAuth, async (req, res) => {
  const selfId    = req.session.userId!;
  const targetId  = parseInt(String(req.params.userId));
  const isSelf    = selfId === targetId;
  const isAdminUser = req.session.isAdmin;

  if (!isSelf && !isAdminUser) return res.status(403).json({ error: "غير مصرح" });

  const { randomBytes } = await import("crypto");
  const newToken = randomBytes(32).toString("hex");
  await db.update(usersTable).set({ directLoginToken: newToken }).where(eq(usersTable.id, targetId));

  res.json({ directLoginToken: newToken });
});

// Get current user
// The person signed in — never the branch service account the session's
// userId may point at, and for staff the member of staff. isAdmin is synced
// from the person's own row only, so a staff session on the owner's branch
// can never inherit the owner's admin flag.
router.get("/me", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  if (req.session.staffId) {
    const [st] = await db.select().from(staffTable).where(eq(staffTable.id, req.session.staffId)).limit(1);
    if (!st || !st.isActive) { req.session.destroy(() => {}); return res.status(401).json({ error: "انتهت صلاحية الدخول" }); }
    req.session.isAdmin = false;
    return res.json({ id: req.session.userId, phone: st.username, displayName: st.name, isAdmin: false, status: "active", role: req.session.role ?? "staff", staffId: st.id });
  }

  const user = await signedInUser(req);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  // Keep session in sync with DB (e.g. if admin was upgraded after login)
  if (!req.session.impersonatorId && req.session.isAdmin !== user.isAdmin) {
    req.session.isAdmin = user.isAdmin;
  }

  res.json({
    id: user.id, phone: user.phone, displayName: user.displayName, isAdmin: req.session.impersonatorId ? false : user.isAdmin,
    status: user.status, createdAt: user.createdAt, role: "owner", impersonating: !!req.session.impersonatorId,
  });
});

// ── Bootstrap admin (one-time setup, requires BOOTSTRAP_SECRET env var) ───────
router.post("/bootstrap-admin", async (req, res) => {
  const secret = process.env["BOOTSTRAP_SECRET"];
  if (!secret) return res.status(404).json({ error: "Not found" });

  const { bootstrapSecret, phone, newPassword } = req.body;
  if (!bootstrapSecret || !phone || !newPassword) {
    return res.status(400).json({ error: "bootstrapSecret, phone, newPassword مطلوبة" });
  }

  const valid = crypto.timingSafeEqual(Buffer.from(bootstrapSecret), Buffer.from(secret));
  if (!valid) return res.status(403).json({ error: "Secret غير صحيح" });

  const rawPhone = String(phone).replace(/[\s\-\+\(\)]/g, "");
  const cleanPhone = rawPhone.replace(/^00/, "");

  let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, cleanPhone));
  if (!user && cleanPhone !== rawPhone) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.phone, rawPhone));
  }
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const hash = await bcrypt.hash(newPassword, 10);
  const token = crypto.randomBytes(32).toString("hex");

  await db.update(usersTable)
    .set({ passwordHash: hash, isAdmin: true, directLoginToken: token })
    .where(eq(usersTable.id, user.id));

  logger.info({ userId: user.id, phone: user.phone }, "bootstrap-admin: upgraded to admin");

  res.json({ ok: true, userId: user.id, phone: user.phone, directLoginToken: token });
});

export default router;
// Note: connectToken backfill handled by admin GET /users on first access
