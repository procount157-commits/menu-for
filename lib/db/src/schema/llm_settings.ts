import { pgTable, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Model provider credentials ────────────────────────────────────
// Stored rather than read only from .env so a key can be added from the UI and
// survive a restart without editing a file on the server — which on a VPS means
// an SSH session and a redeploy for what is a one-line change.
//
// The key is never returned by the API; responses carry a masked form only.
export const llmSettingsTable = pgTable("llm_settings", {
  userId:    integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  provider:  varchar("provider", { length: 30 }).notNull(),
  apiKey:    varchar("api_key", { length: 400 }).notNull(),
  model:     varchar("model", { length: 120 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LlmSettings = typeof llmSettingsTable.$inferSelect;
