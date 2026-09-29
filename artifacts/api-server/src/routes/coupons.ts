import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, couponsTable, couponRedemptionsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { redeemCoupon, CouponError } from "../lib/coupons";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

/**
 * POST /api/coupons/redeem
 * Body: { code: string }
 * Applies a coupon to the authenticated user's account.
 */
router.post("/redeem", async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") return res.status(400).json({ error: "كود الكوبون مطلوب" });
  try {
    const out = await redeemCoupon(req.session.userId!, code);
    res.json({ success: true, ...out });
  } catch (err) {
    if (err instanceof CouponError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export default router;
