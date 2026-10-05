import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, date, uniqueIndex, index, numeric, boolean, primaryKey } from "drizzle-orm/pg-core";
import { orgsTable, branchesTable } from "./menu";

// ── Growth: what keeps a shop selling, and keeps it subscribed ────
// Each table here backs one feature a shop owner can see paying off.

/** The weekly report sent to the owner's phone — one row per shop per week, so it is never sent twice. */
export const ownerReportsTable = pgTable("owner_reports", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  stats:     jsonb("stats").$type<Record<string, unknown>>().notNull(),
  text:      text("text").notNull(),
  sentTo:    jsonb("sent_to").$type<string[]>().notNull().default([]),
  manual:    varchar("manual", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_owner_report_week").on(t.orgId, t.weekStart).where(sql`manual IS NULL`),
  index("idx_owner_reports_org").on(t.orgId, t.createdAt),
]);

export interface ReportPrefs { enabled: boolean; weekday: number; hour: number }

export type OwnerReport = typeof ownerReportsTable.$inferSelect;

/** A coupon (with a code) or a timed deal (without one) — see menu-shared/deals.ts. */
export const shopDealsTable = pgTable("shop_deals", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:     integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
  code:         varchar("code", { length: 24 }),
  title:        varchar("title", { length: 80 }).notNull(),
  kind:         varchar("kind", { length: 8 }).notNull().default("pct"),
  value:        numeric("value", { precision: 10, scale: 2 }).notNull(),
  minSubtotal:  numeric("min_subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  maxDiscount:  numeric("max_discount", { precision: 10, scale: 2 }),
  days:         integer("days").array().notNull().default(sql`'{}'::integer[]`),
  fromTime:     varchar("from_time", { length: 5 }),
  toTime:       varchar("to_time", { length: 5 }),
  startsAt:     timestamp("starts_at", { withTimezone: true }),
  endsAt:       timestamp("ends_at", { withTimezone: true }),
  maxUses:      integer("max_uses"),
  uses:         integer("uses").notNull().default(0),
  oncePerPhone: boolean("once_per_phone").notNull().default(false),
  // A personal code (a birthday, a referral reward) works for this phone only.
  phone:        varchar("phone", { length: 40 }),
  // owner | birthday | referral
  source:       varchar("source", { length: 12 }).notNull().default("owner"),
  // «أرسله لزبائني»: [{ campaignId, at, count, segment }]
  broadcasts:   jsonb("broadcasts").$type<Array<{ campaignId: number; at: string; count: number; segment: string }>>().notNull().default([]),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_shop_deal_code").on(t.orgId, t.code).where(sql`code IS NOT NULL`),
  index("idx_shop_deals_org").on(t.orgId, t.isActive),
]);

export type ShopDeal = typeof shopDealsTable.$inferSelect;

/** Menu counters per day and item (item 0 = the menu itself). No visitor is identified. */
export const menuStatsDailyTable = pgTable("menu_stats_daily", {
  orgId:    integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  day:      date("day").notNull(),
  itemId:   integer("item_id").notNull().default(0),
  views:    integer("views").notNull().default(0),
  adds:     integer("adds").notNull().default(0),
  carts:    integer("carts").notNull().default(0),
  // Of the adds, how many came from «يُطلب معه» in the cart.
  upsells:  integer("upsells").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.branchId, t.day, t.itemId] }),
  index("idx_menu_stats_org_day").on(t.orgId, t.day),
]);

/** A gift card: an amount sent to someone's WhatsApp, spent in one go or bit by bit. */
export const giftCardsTable = pgTable("gift_cards", {
  id:             serial("id").primaryKey(),
  orgId:          integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  code:           varchar("code", { length: 24 }).notNull(),
  token:          varchar("token", { length: 32 }).notNull().unique(),
  amount:         numeric("amount", { precision: 10, scale: 2 }).notNull(),
  balance:        numeric("balance", { precision: 10, scale: 2 }).notNull(),
  buyerName:      varchar("buyer_name", { length: 80 }),
  buyerPhone:     varchar("buyer_phone", { length: 40 }),
  recipientName:  varchar("recipient_name", { length: 80 }),
  recipientPhone: varchar("recipient_phone", { length: 40 }),
  message:        text("message"),
  // active | used | void
  status:         varchar("status", { length: 10 }).notNull().default("active"),
  expiresAt:      timestamp("expires_at", { withTimezone: true }),
  createdBy:      varchar("created_by", { length: 80 }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_gift_card_code").on(t.orgId, t.code)]);

export const giftCardUsesTable = pgTable("gift_card_uses", {
  id:         serial("id").primaryKey(),
  giftCardId: integer("gift_card_id").notNull().references(() => giftCardsTable.id, { onDelete: "cascade" }),
  amount:     numeric("amount", { precision: 10, scale: 2 }).notNull(),
  orderId:    integer("order_id"),
  note:       varchar("note", { length: 200 }),
  byWho:      varchar("by_who", { length: 80 }),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_gift_card_uses").on(t.giftCardId, t.createdAt)]);

export type GiftCard = typeof giftCardsTable.$inferSelect;

/** A friend brought by a customer: the friend's first order, and the customer's reward once it is completed. */
export const customerReferralsTable = pgTable("customer_referrals", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  referrerPhone: varchar("referrer_phone", { length: 40 }).notNull(),
  friendPhone:   varchar("friend_phone", { length: 40 }).notNull(),
  orderId:       integer("order_id"),
  // pending → rewarded · void (the order was cancelled)
  status:        varchar("status", { length: 10 }).notNull().default("pending"),
  rewardDealId:  integer("reward_deal_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  rewardedAt:    timestamp("rewarded_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("uq_referral_friend").on(t.orgId, t.friendPhone),
  index("idx_referrals_referrer").on(t.orgId, t.referrerPhone),
]);

/** A shop's month: customer messages sent (of which marketing), AI replies, campaigns started, credits spent. */
export const orgUsageTable = pgTable("org_usage", {
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  month:        varchar("month", { length: 7 }).notNull(),
  messages:     integer("messages").notNull().default(0),
  marketing:    integer("marketing").notNull().default(0),
  agentReplies: integer("agent_replies").notNull().default(0),
  campaigns:    integer("campaigns").notNull().default(0),
  creditsUsed:  integer("credits_used").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.orgId, t.month] })]);

/** Platform-wide settings the admin edits (the trial's rules live here). */
export const platformSettingsTable = pgTable("platform_settings", {
  key:       varchar("key", { length: 40 }).primaryKey(),
  value:     jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
