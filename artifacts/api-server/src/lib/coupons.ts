// ── Redeeming a coupon ────────────────────────────────────────────
// Shared between the coupons route (a signed-in user typing a code) and
// registration (a code required to open an account at all), so the two
// cannot drift apart on what a code does.

import { and, eq } from "drizzle-orm";
import { db, couponsTable, couponRedemptionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

export class CouponError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Look a code up and check it can still be used, without using it. */
export async function checkCoupon(code: string) {
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code.toUpperCase().trim()));
  if (!coupon) throw new CouponError("كود الدعوة غير صحيح", 404);
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new CouponError("انتهت صلاحية هذا الكود");
  if ((coupon.usedCount ?? 0) >= (coupon.maxUses ?? 1)) throw new CouponError("تم استخدام هذا الكود بالحد الأقصى");
  return coupon;
}

export async function redeemCoupon(userId: number, code: string) {
  const coupon = await checkCoupon(code);

  const [alreadyUsed] = await db.select({ id: couponRedemptionsTable.id }).from(couponRedemptionsTable)
    .where(and(eq(couponRedemptionsTable.couponId, coupon.id), eq(couponRedemptionsTable.userId, userId)));
  if (alreadyUsed) throw new CouponError("لقد استخدمت هذا الكود من قبل");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new CouponError("المستخدم غير موجود", 404);

  const updates: Record<string, any> = {};
  if (coupon.type === "plan" && coupon.planUpgrade) updates.plan = coupon.planUpgrade;
  if (coupon.daysAdded && coupon.daysAdded > 0) {
    const base = user.planExpiresAt && user.planExpiresAt > new Date() ? user.planExpiresAt : new Date();
    updates.planExpiresAt = new Date(base.getTime() + coupon.daysAdded * 24 * 60 * 60 * 1000);
  }
  if (Object.keys(updates).length > 0) await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

  await db.insert(couponRedemptionsTable).values({ couponId: coupon.id, userId });
  await db.update(couponsTable).set({ usedCount: (coupon.usedCount ?? 0) + 1 }).where(eq(couponsTable.id, coupon.id));
  logger.info({ userId, couponId: coupon.id, code: coupon.code }, "Coupon redeemed");

  return {
    message: `تم تطبيق الكود! ${coupon.daysAdded ? `أضفنا ${coupon.daysAdded} يوماً لخطتك.` : ""} ${coupon.planUpgrade ? `خطتك الآن ${coupon.planUpgrade}.` : ""}`.trim(),
    planExpiresAt: (updates.planExpiresAt as Date | undefined) ?? null,
    plan: (updates.plan as string | undefined) ?? user.plan,
  };
}
