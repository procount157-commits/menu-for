import { pgTable, serial, integer, varchar, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const waThreadMessagesTable = pgTable("wa_thread_messages", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:     varchar("phone", { length: 50 }).notNull(),
  messageId: varchar("message_id", { length: 100 }),
  text:      text("text"),
  msgType:   varchar("msg_type", { length: 20 }).default("text"),
  fromMe:    boolean("from_me").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Gives onConflictDoNothing() something to conflict on. Without it the same
  // history is re-inserted whole on every reconnect.
  uniqueIndex("idx_wa_thread_msgs_dedup")
    .on(t.userId, t.messageId)
    .where(sql`${t.messageId} IS NOT NULL`),
]);
