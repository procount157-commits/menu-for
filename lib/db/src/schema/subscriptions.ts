import { pgTable, serial, varchar, text, numeric, boolean, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// The plans shown on the home page, and the sign-up requests it collects.
// routes/plans.ts and routes/leads.ts query these with SQL; they are declared
// here so `drizzle-kit push` knows the tables and never drops them.
export const subscriptionPlansTable = pgTable("subscription_plans", {
  id:            serial("id").primaryKey(),
  name:          varchar("name", { length: 120 }).notNull(),
  nameEn:        varchar("name_en", { length: 120 }),
  price:         numeric("price", { precision: 10, scale: 2 }).notNull(),
  period:        varchar("period", { length: 20 }).notNull().default("monthly"),
  periodLabel:   varchar("period_label", { length: 60 }),
  description:   text("description"),
  descriptionEn: text("description_en"),
  features:      jsonb("features").$type<string[]>().notNull().default([]),
  featuresEn:    jsonb("features_en").$type<string[]>().notNull().default([]),
  badge:         varchar("badge", { length: 60 }),
  badgeEn:       varchar("badge_en", { length: 60 }),
  isActive:      boolean("is_active").notNull().default(true),
  isFeatured:    boolean("is_featured").notNull().default(false),
  sortOrder:     integer("sort_order").notNull().default(0),
  // Which PLAN_LIMITS tier a subscriber of this plan is put on.
  planKey:       varchar("plan_key", { length: 20 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const subscriptionLeadsTable = pgTable("subscription_leads", {
  id:                 serial("id").primaryKey(),
  name:               varchar("name", { length: 160 }),
  phone:              varchar("phone", { length: 40 }).notNull(),
  planName:           varchar("plan_name", { length: 120 }),
  businessType:       varchar("business_type", { length: 80 }),
  estimatedCustomers: varchar("estimated_customers", { length: 60 }),
  notes:              text("notes"),
  source:             varchar("source", { length: 40 }).notNull().default("landing"),
  status:             varchar("status", { length: 20 }).notNull().default("new"),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_subscription_leads_status").on(t.status, t.createdAt)]);
