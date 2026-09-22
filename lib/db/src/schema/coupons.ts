import { pgTable, serial, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const couponsTable = pgTable("coupons", {
  id:          serial("id").primaryKey(),
  code:        varchar("code", { length: 16 }).notNull().unique(),
  label:       varchar("label", { length: 100 }),
  type:        varchar("type", { length: 20 }).notNull().default("days"),
  planUpgrade: varchar("plan_upgrade", { length: 20 }),
  daysAdded:   integer("days_added").default(30),
  maxUses:     integer("max_uses").default(1),
  usedCount:   integer("used_count").default(0).notNull(),
  createdBy:   integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  expiresAt:   timestamp("expires_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const couponRedemptionsTable = pgTable("coupon_redemptions", {
  id:         serial("id").primaryKey(),
  couponId:   integer("coupon_id").notNull().references(() => couponsTable.id, { onDelete: "cascade" }),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});

export type Coupon           = typeof couponsTable.$inferSelect;
export type CouponRedemption = typeof couponRedemptionsTable.$inferSelect;
