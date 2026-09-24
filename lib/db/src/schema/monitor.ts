import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Monitoring reports ────────────────────────────────────────────
// Each run of the monitor writes one row. Kept rather than only logged so a
// problem can be traced backwards: "it stopped receiving at some point" is
// answerable by looking at when the verdict changed, not by guessing.
export const monitorReportsTable = pgTable("monitor_reports", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // ok | warning | critical
  level:     varchar("level", { length: 12 }).notNull(),
  summary:   text("summary").notNull(),
  // [{ area, level, message, action? }] — written as sentences, not metrics,
  // because the point is to say what to do about it.
  findings:  jsonb("findings").notNull().default([]),
  metrics:   jsonb("metrics").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_monitor_reports_user").on(t.userId, t.createdAt)]);

export type MonitorReport = typeof monitorReportsTable.$inferSelect;
export interface MonitorFinding {
  area: "connection" | "ban_risk" | "replies" | "resources";
  level: "ok" | "warning" | "critical";
  message: string;
  action?: string;
}
