// ── The graph: receipts and goals ─────────────────────────────────
// Created by migration 122 — with the triggers that chain every receipt to
// the one before it and refuse an update or a delete, which drizzle does not
// manage. Declared here so `drizzle-kit push` knows the tables and never
// drops them; the code reads and writes them with SQL (lib/graph).

import { pgTable, serial, bigserial, integer, varchar, text, timestamp, jsonb, boolean, char, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const receiptsTable = pgTable("receipts", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  userId:      integer("user_id").notNull(),
  at:          timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  graph:       varchar("graph", { length: 24 }),
  node:        varchar("node", { length: 40 }).notNull(),
  nodeVersion: varchar("node_version", { length: 24 }),
  goalId:      integer("goal_id"),
  runId:       varchar("run_id", { length: 64 }),
  action:      varchar("action", { length: 40 }).notNull(),
  status:      varchar("status", { length: 12 }).notNull(),
  subject:     varchar("subject", { length: 160 }),
  inputRef:    varchar("input_ref", { length: 160 }),
  outputRef:   varchar("output_ref", { length: 160 }),
  evidence:    jsonb("evidence"),
  metric:      jsonb("metric"),
  model:       varchar("model", { length: 80 }),
  tokensIn:    integer("tokens_in"),
  tokensOut:   integer("tokens_out"),
  durationMs:  integer("duration_ms"),
  edge:        varchar("edge", { length: 60 }),
  why:         text("why"),
  inferred:    boolean("inferred").notNull().default(false),
  prevHash:    char("prev_hash", { length: 64 }),
  hash:        char("hash", { length: 64 }),
}, (t) => [
  index("idx_receipts_user_at").on(t.userId, t.at),
  index("idx_receipts_node").on(t.userId, t.node, t.at),
]);

export const goalsTable = pgTable("goals", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title:          varchar("title", { length: 200 }).notNull(),
  metric:         varchar("metric", { length: 40 }).notNull(),
  target:         integer("target").notNull(),
  startsAt:       timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  deadline:       timestamp("deadline", { withTimezone: true }).notNull(),
  counterMetrics: jsonb("counter_metrics").$type<string[]>().notNull().default([]),
  anchor:         varchar("anchor", { length: 40 }),
  parentId:       integer("parent_id"),
  status:         varchar("status", { length: 12 }).notNull().default("active"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_goals_user").on(t.userId, t.status)]);
