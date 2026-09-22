import { pgTable, integer, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const waContactsTable = pgTable("wa_contacts", {
  userId:        integer("user_id").notNull(),
  phone:         text("phone").notNull(),
  name:          text("name"),
  lastMessageAt: bigint("last_message_at", { mode: "number" }).default(0),
  source:        text("source").default("chat"),
  updatedAt:     timestamp("updated_at").defaultNow(),
});
