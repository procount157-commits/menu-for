import { pgTable, serial, integer, varchar, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { usersTable } from "./users";

export const campaignButtonResponsesTable = pgTable("campaign_button_responses", {
  id:          serial("id").primaryKey(),
  campaignId:  integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  userId:      integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  phone:       varchar("phone", { length: 50 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }),
  buttonText:  text("button_text").notNull(),
  action:      varchar("action", { length: 20 }).notNull(), // 'interested' | 'not_interested'
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("campaign_button_responses_unique").on(t.campaignId, t.phone, t.action),
]);

export const insertCampaignButtonResponseSchema = createInsertSchema(campaignButtonResponsesTable).omit({ id: true, createdAt: true });

export type CampaignButtonResponse = typeof campaignButtonResponsesTable.$inferSelect;
export type InsertCampaignButtonResponse = z.infer<typeof insertCampaignButtonResponseSchema>;
