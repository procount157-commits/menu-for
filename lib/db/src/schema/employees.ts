import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Bot employees ─────────────────────────────────────────────────
// The bots, given names and roles. A table rather than constants because the
// owner thinks of them as staff — "the first is Hal, the second is Mark" —
// and expects to hire more, rename them, and take one off duty without that
// meaning a code change.
//
// `role` binds a row to the engine behind it; `kind` distinguishes a
// customer-facing employee from an internal one, which is what decides
// whether switching it on sends anything to anybody.
export const botEmployeesTable = pgTable("bot_employees", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:      varchar("name", { length: 80 }).notNull(),
  role:      varchar("role", { length: 30 }).notNull(),   // sales | monitor
  kind:      varchar("kind", { length: 20 }).notNull().default("customer"), // customer | internal
  title:     varchar("title", { length: 120 }),
  avatar:    varchar("avatar", { length: 16 }),
  isActive:  boolean("is_active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_bot_employees_user").on(t.userId)]);

export type BotEmployee = typeof botEmployeesTable.$inferSelect;

/** Hired for an account the first time it links WhatsApp. */
export const DEFAULT_EMPLOYEES = [
  { name: "هال",  role: "sales",   kind: "customer", title: "موظف المبيعات",  avatar: "🤝" },
  { name: "مارك", role: "monitor", kind: "internal", title: "موظف المراقبة", avatar: "🛡️" },
] as const;
