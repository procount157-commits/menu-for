import { pgTable, serial, integer, varchar, text, boolean, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── What the operations officer may change ────────────────────────
// Deliberately a small, blunt set. Every one of these makes the account send
// less or slower; none of them can make it send more. An agent that could
// raise a limit would be one bad judgement away from a ban, and the whole
// point of the role is the opposite.
export const opsControlsTable = pgTable("ops_controls", {
  userId:       integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Multiplies the gap between messages. 1 = as calculated. */
  throttle:     numeric("throttle", { precision: 4, scale: 2 }).notNull().default("1"),
  /** Ceiling on today, below whatever the warm-up curve allows. */
  dailyCeiling: integer("daily_ceiling"),
  /** All sending stops until this passes. */
  holdUntil:    timestamp("hold_until", { withTimezone: true }),
  reason:       text("reason"),
  /** An owner's decision is not overwritten by the next sweep. */
  setBy:        varchar("set_by", { length: 20 }).notNull().default("agent"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const opsAlertsTable = pgTable("ops_alerts", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  level:        varchar("level", { length: 20 }).notNull(),
  headline:     varchar("headline", { length: 200 }).notNull(),
  body:         text("body"),
  actions:      jsonb("actions").notNull().default([]),
  signals:      jsonb("signals").notNull().default({}),
  acknowledged: boolean("acknowledged").notNull().default(false),
  notifiedAt:   timestamp("notified_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_ops_alerts").on(t.userId, t.createdAt)]);

export type OpsControls = typeof opsControlsTable.$inferSelect;
export type OpsAlert    = typeof opsAlertsTable.$inferSelect;
