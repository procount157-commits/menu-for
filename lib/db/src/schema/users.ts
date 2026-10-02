import {
  pgTable, text, serial, boolean, timestamp, varchar, numeric, integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id:           serial("id").primaryKey(),
  phone:        varchar("phone", { length: 20 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName:  varchar("display_name", { length: 255 }),
  isAdmin:      boolean("is_admin").default(false).notNull(),
  status:       varchar("status", { length: 20 }).default("active").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),

  // ── SaaS subscription plan ───────────────────────────────────────
  plan:          varchar("plan", { length: 20 }).default("free").notNull(),
  planExpiresAt: timestamp("plan_expires_at"),
  monthlyPrice:  numeric("monthly_price", { precision: 10, scale: 2 }).default("0"),
  notes:         text("notes"),

  // ── Public WhatsApp connect link ─────────────────────────────────
  connectToken:      varchar("connect_token", { length: 36 }),

  // ── QR control (admin can disable per user) ──────────────────────
  qrDisabled:   boolean("qr_disabled").default(false).notNull(),
  currentQr:    text("current_qr"),
  qrExpiresAt:  timestamp("qr_expires_at"),

  // ── Direct admin login link (password-free) ───────────────────────
  directLoginToken:  varchar("direct_login_token", { length: 64 }),

  // ── Activity tracking ─────────────────────────────────────────────
  lastLoginAt: timestamp("last_login_at"),

  // ── Usage limits (set by admin) ───────────────────────────────────
  dailyMessageLimit: integer("daily_message_limit"),

  // ── Menu For You ──────────────────────────────────────────────────
  // owner: a person who signs in · branch: a service account that only holds
  // a branch's own WhatsApp number and its Flow Hub data, never signed in to.
  kind:  varchar("kind", { length: 10 }).default("owner").notNull(),
  orgId: integer("org_id"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });

export type User       = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ── Plan limits reference ─────────────────────────────────────────
export const PLAN_LIMITS = {
  // contacts / campaigns / chatbots are Flow Hub's; the rest are Menu For You's.
  // -1 = unlimited, 0 = not in this plan. «الشاملة» (business) is the full
  // package sold monthly or yearly; «احترافي» is kept for anyone already on it
  // but is no longer offered.
  free:     { name: "تجريبي",  contacts: 200,  campaigns: 0,  chatbots: 1,  branches: 1,  items: 30, staff: 2,  queue: true,  booking: false, notify: false, marketing: false, display: false, branchNumbers: false, email: false },
  basic:    { name: "أساسي",   contacts: 500,  campaigns: 0,  chatbots: 1,  branches: 1,  items: -1, staff: 3,  queue: false, booking: false, notify: false, marketing: false, display: false, branchNumbers: false, email: false },
  pro:      { name: "احترافي", contacts: 5000, campaigns: 60, chatbots: 5,  branches: 3,  items: -1, staff: 10, queue: true,  booking: true,  notify: true,  marketing: true,  display: false, branchNumbers: false, email: false },
  business: { name: "الشاملة", contacts: -1,   campaigns: -1, chatbots: -1, branches: -1, items: -1, staff: -1, queue: true,  booking: true,  notify: true,  marketing: true,  display: true,  branchNumbers: true,  email: true },
} as const;
