import { pgTable, integer, text, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Persists WhatsApp Baileys auth state (creds + Signal keys) in PostgreSQL.
 * This survives server restarts and new deployments — unlike the filesystem.
 *
 * key  = Baileys filename without path, e.g. "creds.json", "pre-key-1.json"
 * value = JSON string serialised with Baileys' BufferJSON.replacer
 */
export const waAuthStateTable = pgTable(
  "wa_auth_state",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    key:   text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
