import { pgTable, serial, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Internal assistant ────────────────────────────────────────────
// The operator's own bot, not the customer-facing one. Threads live on the
// server rather than in the browser so a conversation survives a reload and
// follows the user between devices — memory that only exists in a tab is not
// memory.
export const assistantThreadsTable = pgTable("assistant_threads", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title:     varchar("title", { length: 255 }).notNull().default("محادثة جديدة"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_assistant_threads_user").on(t.userId, t.updatedAt)]);

export const assistantMessagesTable = pgTable("assistant_messages", {
  id:        serial("id").primaryKey(),
  threadId:  integer("thread_id").notNull().references(() => assistantThreadsTable.id, { onDelete: "cascade" }),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role:      varchar("role", { length: 12 }).notNull(),   // user | assistant
  content:   text("content").notNull(),
  provider:  varchar("provider", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_assistant_msgs_thread").on(t.threadId, t.createdAt)]);

export type AssistantThread  = typeof assistantThreadsTable.$inferSelect;
export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
