// ── The Menu For You sales employee ───────────────────────────────
// A prospect is a shop the platform's own seller talks to on WhatsApp; a
// touch is one thing that happened with it — our opener or follow-up, their
// reply, a click on a link we sent, a stage change, a lesson from the trainer.

import { pgTable, serial, integer, varchar, text, timestamp, jsonb, smallint, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { orgsTable } from "./menu";

export type SalesStage = "new" | "contacted" | "replied" | "interested" | "trial" | "won" | "lost" | "stopped" | "paused";
export interface SalesFact { fact: string; at: string }
export interface SalesLinkSent { key: string; at: string }

export const salesProspectsTable = pgTable("sales_prospects", {
  id:          serial("id").primaryKey(),
  waUserId:    integer("wa_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:       varchar("phone", { length: 20 }).notNull(),
  name:        varchar("name", { length: 120 }),
  business:    varchar("business", { length: 160 }),
  vertical:    varchar("vertical", { length: 20 }),
  city:        varchar("city", { length: 80 }),
  source:      varchar("source", { length: 40 }).notNull().default("manual"),
  stage:       varchar("stage", { length: 16 }).$type<SalesStage>().notNull().default("new"),
  step:        integer("step").notNull().default(0),
  token:       varchar("token", { length: 12 }).notNull().unique(),
  priority:    integer("priority").notNull().default(0),
  nextAt:      timestamp("next_at", { withTimezone: true }),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
  lastSentAt:  timestamp("last_sent_at", { withTimezone: true }),
  lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
  replies:     integer("replies").notNull().default(0),
  clicks:      integer("clicks").notNull().default(0),
  lastClickAt: timestamp("last_click_at", { withTimezone: true }),
  linksSent:   jsonb("links_sent").$type<SalesLinkSent[]>().notNull().default([]),
  facts:       jsonb("facts").$type<SalesFact[]>().notNull().default([]),
  summary:     text("summary"),
  interest:    smallint("interest"),
  orgId:       integer("org_id").references(() => orgsTable.id, { onDelete: "set null" }),
  stopReason:  varchar("stop_reason", { length: 80 }),
  note:        text("note"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("sales_prospects_wa_user_id_phone_key").on(t.waUserId, t.phone),
  index("idx_sales_due").on(t.waUserId, t.stage, t.nextAt),
]);

export type SalesProspect = typeof salesProspectsTable.$inferSelect;

export type TouchKind = "opener" | "followup" | "reply" | "inbound" | "click" | "stage" | "note" | "teach";
export const salesTouchesTable = pgTable("sales_touches", {
  id:         serial("id").primaryKey(),
  prospectId: integer("prospect_id").notNull().references(() => salesProspectsTable.id, { onDelete: "cascade" }),
  waUserId:   integer("wa_user_id").notNull(),
  kind:       varchar("kind", { length: 16 }).$type<TouchKind>().notNull(),
  step:       integer("step"),
  text:       text("text"),
  links:      jsonb("links").$type<string[]>().notNull().default([]),
  by:         varchar("by", { length: 12 }).notNull().default("ai"),
  status:     varchar("status", { length: 12 }).notNull().default("sent"),
  meta:       jsonb("meta").$type<Record<string, unknown>>(),
  at:         timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_sales_touch_p").on(t.prospectId, t.at), index("idx_sales_touch_day").on(t.waUserId, t.kind, t.at)]);

export type SalesTouch = typeof salesTouchesTable.$inferSelect;
