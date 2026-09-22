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
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });

export type User       = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ── Plan limits reference ─────────────────────────────────────────
export const PLAN_LIMITS = {
  free:  { name: "مجاني",   contacts: 200,  campaigns: 5,   chatbots: 1  },
  basic: { name: "أساسي",   contacts: 2000, campaigns: 30,  chatbots: 5  },
  pro:   { name: "احترافي", contacts: -1,   campaigns: -1,  chatbots: -1 },
} as const;
