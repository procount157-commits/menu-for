import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, couponsTable, couponRedemptionsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

/**
 * POST /api/coupons/redeem
 * Body: { code: string }
 * Applies a coupon to the authenticated user's account.
 */
router.post("/redeem", async (req, res) => {
  const userId = req.session.userId!;
  const { code } = req.body;

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "كود الكوبون مطلوب" });
  }

  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.code, code.toUpperCase().trim()));

  if (!coupon) return res.status(404).json({ error: "كود الكوبون غير صحيح" });

  // Check expiry
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return res.status(400).json({ error: "انتهت صلاحية هذا الكوبون" });
  }

  // Check usage limit
  if (coupon.usedCount! >= coupon.maxUses!) {
    return res.status(400).json({ error: "تم استخدام هذا الكوبون بالحد الأقصى" });
  }

  // Check if user already redeemed this coupon
  const [alreadyUsed] = await db
    .select({ id: couponRedemptionsTable.id })
    .from(couponRedemptionsTable)
    .where(
      and(
        eq(couponRedemptionsTable.couponId, coupon.id),
        eq(couponRedemptionsTable.userId, userId)
      )
    );

  if (alreadyUsed) {
    return res.status(400).json({ error: "لقد استخدمت هذا الكوبون من قبل" });
  }

  // Get current user
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  // Calculate new plan/expiry
  const updates: Record<string, any> = {};

  if (coupon.type === "plan" && coupon.planUpgrade) {
    updates.plan = coupon.planUpgrade;
  }

  if (coupon.daysAdded && coupon.daysAdded > 0) {
    const base = user.planExpiresAt && user.planExpiresAt > new Date()
      ? user.planExpiresAt
      : new Date();
    updates.planExpiresAt = new Date(base.getTime() + coupon.daysAdded * 24 * 60 * 60 * 1000);
  }

  if (coupon.type === "plan" && coupon.planUpgrade && !updates.plan) {
    updates.plan = coupon.planUpgrade;
  }

  // Apply updates to user
  if (Object.keys(updates).length > 0) {
    await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));
  }

  // Record redemption + increment used count
  await db.insert(couponRedemptionsTable).values({ couponId: coupon.id, userId });
  await db.update(couponsTable)
    .set({ usedCount: (coupon.usedCount ?? 0) + 1 })
    .where(eq(couponsTable.id, coupon.id));

  logger.info({ userId, couponId: coupon.id, code: coupon.code }, "Coupon redeemed");

  res.json({
    success: true,
    message: `تم تطبيق الكوبون بنجاح! ${coupon.daysAdded ? `أضفنا ${coupon.daysAdded} يوم لخطتك.` : ""} ${coupon.planUpgrade ? `تمت ترقيتك إلى خطة ${coupon.planUpgrade}.` : ""}`.trim(),
    planExpiresAt: updates.planExpiresAt ?? null,
    plan: updates.plan ?? user.plan,
  });
});

export default router;
