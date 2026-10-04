import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { orgsTable } from "./menu";

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
