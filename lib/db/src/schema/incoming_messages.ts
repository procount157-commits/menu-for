import { pgTable, serial, integer, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const incomingMessagesTable = pgTable("incoming_messages", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:      varchar("phone", { length: 50 }).notNull(),
  messageId:  varchar("message_id", { length: 100 }),
  text:       text("text"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("idx_incoming_msgs_dedup")
    .on(t.userId, t.messageId)
    .where(sql`${t.messageId} IS NOT NULL`),
]);
