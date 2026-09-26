import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Meetings ──────────────────────────────────────────────────────
// The message bus was not a conversation: sixteen messages had passed between
// the employees without one question or answer among them, and a single one
// had ever been read. Everything went one way to the manager and nothing came
// back, which is a notification log.
//
// A meeting has an order. The chair opens on an agenda built from real
// numbers, each employee speaks having read what was said before them, the
// chair puts a question to whoever needs it, and closes with decisions that
// become standing instructions for whoever they apply to.
export const meetingsTable = pgTable("meetings", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind:      varchar("kind", { length: 20 }).notNull().default("daily"),
  title:     varchar("title", { length: 160 }).notNull(),
  /** What was known when it was called, so a decision can be judged on it. */
  agenda:    jsonb("agenda").notNull().default({}),
  summary:   text("summary"),
  /** [{ role, rule }] — what the chair decided, and for whom. */
  decisions: jsonb("decisions").notNull().default([]),
  status:    varchar("status", { length: 20 }).notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt:   timestamp("ended_at", { withTimezone: true }),
}, (t) => [index("idx_meetings").on(t.userId, t.startedAt)]);

export const meetingTurnsTable = pgTable("meeting_turns", {
  id:         serial("id").primaryKey(),
  meetingId:  integer("meeting_id").notNull().references(() => meetingsTable.id, { onDelete: "cascade" }),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  seq:        integer("seq").notNull(),
  role:       varchar("role", { length: 30 }).notNull(),
  kind:       varchar("kind", { length: 20 }).notNull().default("report"),
  /** Set when this answers an earlier turn, so the thread reads as one. */
  inReplyTo:  integer("in_reply_to"),
  body:       text("body").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_meeting_turns").on(t.meetingId, t.seq)]);

export type Meeting     = typeof meetingsTable.$inferSelect;
export type MeetingTurn = typeof meetingTurnsTable.$inferSelect;
