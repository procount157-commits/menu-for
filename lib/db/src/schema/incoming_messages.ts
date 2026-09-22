import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const incomingMessagesTable = pgTable("incoming_messages", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:      varchar("phone", { length: 50 }).notNull(),
  messageId:  varchar("message_id", { length: 100 }),
  text:       text("text"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});
