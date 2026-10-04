import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, date, uniqueIndex, index, numeric, boolean } from "drizzle-orm/pg-core";
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
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_shop_deal_code").on(t.orgId, t.code).where(sql`code IS NOT NULL`),
  index("idx_shop_deals_org").on(t.orgId, t.isActive),
]);

export type ShopDeal = typeof shopDealsTable.$inferSelect;
