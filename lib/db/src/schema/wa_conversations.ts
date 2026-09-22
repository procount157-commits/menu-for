import { pgTable, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const waConversationsTable = pgTable("wa_conversations", {
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:     varchar("phone", { length: 50 }).notNull(),
  name:      varchar("name", { length: 255 }),
  lastMsgAt: timestamp("last_msg_at", { withTimezone: true }).defaultNow().notNull(),
  lastText:  text("last_text"),
  msgCount:  integer("msg_count").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
