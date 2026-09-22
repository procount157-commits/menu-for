import { pgTable, text, serial, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactGroupsTable } from "./contacts";
import { usersTable } from "./users";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  contactGroupId: integer("contact_group_id").references(() => contactGroupsTable.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  messageType: varchar("message_type", { length: 20 }).default("text").notNull(),
  mediaUrl: text("media_url"),
  buttons: text("buttons"),
  carousel: text("carousel"),
  companyName: varchar("company_name", { length: 255 }),
  delayMin: integer("delay_min").default(5).notNull(),
  delayMax: integer("delay_max").default(15).notNull(),
  messageLimit: integer("message_limit"),
  scheduledAt: timestamp("scheduled_at"),
  sentCount: integer("sent_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  totalCount: integer("total_count").default(0).notNull(),
  deliveredCount: integer("delivered_count").default(0).notNull(),
  readCount: integer("read_count").default(0).notNull(),
  autoPauseReason: varchar("auto_pause_reason", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageLogs = pgTable("message_logs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  phone: varchar("phone", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  messageId: varchar("message_id", { length: 255 }),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, sentCount: true, failedCount: true, totalCount: true });
export const insertMessageLogSchema = createInsertSchema(messageLogs).omit({ id: true, createdAt: true });

export type Campaign = typeof campaignsTable.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type MessageLog = typeof messageLogs.$inferSelect;
