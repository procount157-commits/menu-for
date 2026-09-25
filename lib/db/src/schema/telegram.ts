import { pgTable, serial, integer, varchar, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Telegram ──────────────────────────────────────────────────────
// Reports reach the owner where they already are. The chat id cannot be
// configured in advance: Telegram does not let a bot open a conversation, so
// it is only knowable once the owner has messaged the bot first.
export const telegramSettingsTable = pgTable("telegram_settings", {
  userId:    integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  botToken:  varchar("bot_token", { length: 200 }).notNull(),
  chatId:    varchar("chat_id", { length: 50 }),
  chatTitle: varchar("chat_title", { length: 120 }),
  enabled:   boolean("enabled").notNull().default(true),
  linkedAt:  timestamp("linked_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── What the collector works out about each contact ───────────────
// Stored rather than computed on demand, so today's assessment can be compared
// with yesterday's. "Moved from read to replied" is the interesting fact, and
// a live query cannot see it.
export const contactSegmentsTable = pgTable("contact_segments", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:       varchar("phone", { length: 50 }).notNull(),
  segment:     varchar("segment", { length: 30 }).notNull(),
  reason:      text("reason"),
  /** 0..100 — the order to chase them in. */
  score:       integer("score").notNull().default(0),
  sent:        integer("sent").notNull().default(0),
  delivered:   integer("delivered").notNull().default(0),
  read:        integer("read").notNull().default(0),
  replied:     integer("replied").notNull().default(0),
  lastReadAt:  timestamp("last_read_at", { withTimezone: true }),
  lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
  assessedAt:  timestamp("assessed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("idx_segment_current").on(t.userId, t.phone),
  index("idx_segment_score").on(t.userId, t.segment, t.score),
]);

export type TelegramSettings = typeof telegramSettingsTable.$inferSelect;
export type ContactSegment   = typeof contactSegmentsTable.$inferSelect;
