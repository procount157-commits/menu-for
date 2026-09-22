import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chatbotsTable = pgTable("chatbots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  welcomeMessage: text("welcome_message").notNull(),
  nodes: text("nodes").default("[]").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatbotSchema = createInsertSchema(chatbotsTable).omit({ id: true, createdAt: true });

export type Chatbot = typeof chatbotsTable.$inferSelect;
export type InsertChatbot = z.infer<typeof insertChatbotSchema>;
