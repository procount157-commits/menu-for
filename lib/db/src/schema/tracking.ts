import {
  pgTable, serial, integer, text, varchar, boolean, timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const trackingPixelsTable = pgTable("tracking_pixels", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform:    varchar("platform", { length: 20 }).notNull(), // 'meta' | 'snapchat' | 'tiktok'
  pixelId:     text("pixel_id").notNull(),
  accessToken: text("access_token").notNull(),
  testCode:    text("test_code"),
  enabled:     boolean("enabled").default(true).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const trackingLinksTable = pgTable("tracking_links", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  code:        varchar("code", { length: 12 }).notNull().unique(),
  title:       varchar("title", { length: 255 }).notNull(),
  originalUrl: text("original_url").notNull(),
  campaignId:  integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  clicks:      integer("clicks").default(0).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const trackingEventsTable = pgTable("tracking_events", {
  id:          serial("id").primaryKey(),
  linkId:      integer("link_id").notNull().references(() => trackingLinksTable.id, { onDelete: "cascade" }),
  userId:      integer("user_id").notNull(),
  phone:       varchar("phone", { length: 50 }),
  ip:          varchar("ip", { length: 64 }),
  userAgent:   text("user_agent"),
  referer:     text("referer"),
  metaFired:   boolean("meta_fired").default(false).notNull(),
  snapFired:   boolean("snap_fired").default(false).notNull(),
  tiktokFired: boolean("tiktok_fired").default(false).notNull(),
  clickedAt:   timestamp("clicked_at").defaultNow().notNull(),
});
