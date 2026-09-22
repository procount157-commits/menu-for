import { pgTable, serial, integer, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
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
});
