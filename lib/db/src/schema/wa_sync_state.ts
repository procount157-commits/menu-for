import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const waSyncStateTable = pgTable("wa_sync_state", {
  userId:           integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  syncStatus:       text("sync_status").notNull().default("idle"),
  lastFullSyncAt:   timestamp("last_full_sync_at", { withTimezone: true }),
  chatsSynced:      integer("chats_synced").notNull().default(0),
  messagesSynced:   integer("messages_synced").notNull().default(0),
  threadMsgsSynced: integer("thread_msgs_synced").notNull().default(0),
  contactsSynced:   integer("contacts_synced").notNull().default(0),
  lastError:        text("last_error"),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
