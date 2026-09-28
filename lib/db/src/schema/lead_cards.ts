import { pgTable, integer, varchar, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── The lead card ─────────────────────────────────────────────────
// What the team knows about a lead, as fields. Written by rules from the
// customer's own messages, read into every prompt so the employee is told
// which stage it is in rather than left to infer it, and shown to the owner.
// Also where a person's takeover of the thread is recorded.
export const leadCardsTable = pgTable("lead_cards", {
  userId:        integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:         varchar("phone", { length: 50 }).notNull(),
  /** 1 open · 2 discovery · 3 diagnosis · 4 value · 5 offer · 6 objection · 7 agreed */
  stage:         integer("stage").notNull().default(1),
  licence:       varchar("licence", { length: 20 }),
  activity:      varchar("activity", { length: 80 }),
  size:          varchar("size", { length: 80 }),
  staff:         varchar("staff", { length: 40 }),
  taxStatus:     varchar("tax_status", { length: 40 }),
  accountant:    varchar("accountant", { length: 80 }),
  pain:          varchar("pain", { length: 120 }),
  objection:     varchar("objection", { length: 80 }),
  agreedAt:      timestamp("agreed_at", { withTimezone: true }),
  /** A person holds the thread until this passes. */
  humanUntil:    timestamp("human_until", { withTimezone: true }),
  humanBy:       varchar("human_by", { length: 20 }),
  lastIntent:    varchar("last_intent", { length: 20 }),
  turns:         integer("turns").notNull().default(0),
  notifiedStage: integer("notified_stage").notNull().default(0),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.phone] }),
  index("idx_lead_cards_stage").on(t.userId, t.stage, t.updatedAt),
]);

export type LeadCard = typeof leadCardsTable.$inferSelect;
