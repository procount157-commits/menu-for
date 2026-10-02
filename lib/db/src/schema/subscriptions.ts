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

// ── The weekly WhatsApp autopilot ─────────────────────────────────
// One row per linked number (a branch's Flow Hub account).
export const waAutopilotTable = pgTable("wa_autopilot", {
  waUserId:      integer("wa_user_id").primaryKey(),
  orgId:         integer("org_id").notNull(),
  enabled:       boolean("enabled").notNull().default(false),
  /** 0 Sunday … 6 Saturday, in the shop's timezone. */
  weekday:       integer("weekday").notNull().default(4),
  hour:          integer("hour").notNull().default(17),
  // opted_in | regulars | inactive | new
  audience:      varchar("audience", { length: 20 }).notNull().default("opted_in"),
  // approval: the owner reads it first · auto: the guard passes it
  mode:          varchar("mode", { length: 10 }).notNull().default("approval"),
  // agent: written from this week's offers and menu · fixed: the owner's text
  source:        varchar("source", { length: 10 }).notNull().default("agent"),
  fixedMessage:  text("fixed_message"),
  instructions:  text("instructions"),
  maxRecipients: integer("max_recipients").notNull().default(300),
  /** Nobody hears from a campaign twice within this many days. */
  restDays:      integer("rest_days").notNull().default(6),
  lastRunAt:     timestamp("last_run_at", { withTimezone: true }),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const waAutopilotRunsTable = pgTable("wa_autopilot_runs", {
  id:         serial("id").primaryKey(),
  waUserId:   integer("wa_user_id").notNull(),
  orgId:      integer("org_id").notNull(),
  kind:       varchar("kind", { length: 20 }).notNull().default("weekly"),
  // awaiting_approval | started | skipped | rejected | failed
  status:     varchar("status", { length: 20 }).notNull(),
  campaignId: integer("campaign_id"),
  groupId:    integer("group_id"),
  audience:   varchar("audience", { length: 20 }),
  recipients: integer("recipients").notNull().default(0),
  message:    text("message"),
  writtenBy:  varchar("written_by", { length: 30 }),
  note:       text("note"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt:  timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("idx_wa_autopilot_runs").on(t.waUserId, t.createdAt)]);

// ── Model keys per channel ────────────────────────────────────────
// WhatsApp replies and email writing can run on different keys (and several
// each, tried in order), so one channel's usage never starves the other.
export const llmKeysTable = pgTable("llm_keys", {
  id:        serial("id").primaryKey(),
  // whatsapp | email
  channel:   varchar("channel", { length: 12 }).notNull(),
  provider:  varchar("provider", { length: 30 }).notNull(),
  apiKey:    varchar("api_key", { length: 400 }).notNull(),
  model:     varchar("model", { length: 120 }),
  label:     varchar("label", { length: 80 }),
  isActive:  boolean("is_active").notNull().default(true),
  sort:      integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_llm_keys_channel").on(t.channel, t.isActive, t.sort)]);

export type WaAutopilot = typeof waAutopilotTable.$inferSelect;
export type WaAutopilotRun = typeof waAutopilotRunsTable.$inferSelect;
