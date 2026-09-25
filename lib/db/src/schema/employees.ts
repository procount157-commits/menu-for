import { pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
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
  // How this one talks and what they are like. Free text, in the owner's
  // words — it is pasted into the agent's instructions verbatim.
  persona:     text("persona"),
  // Topics that route to them. Empty means "anything not claimed by someone
  // more specific", which is what makes a generalist a sensible default.
  specialties: jsonb("specialties").notNull().default([]),
  // Where they pass a conversation they should not be holding.
  handoffTo:   varchar("handoff_to", { length: 30 }),
  // Lower wins when two agents both match.
  priority:    integer("priority").notNull().default(100),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_bot_employees_user").on(t.userId)]);

export type BotEmployee = typeof botEmployeesTable.$inferSelect;

// Who is on a conversation now, so a thread does not change hands every message.
export const conversationOwnerTable = pgTable("conversation_owner", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:  varchar("phone", { length: 50 }).notNull(),
  role:   varchar("role", { length: 30 }).notNull(),
  since:  timestamp("since", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.phone] })]);

export const agentHandoffsTable = pgTable("agent_handoffs", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:     varchar("phone", { length: 50 }).notNull(),
  fromRole:  varchar("from_role", { length: 30 }),
  toRole:    varchar("to_role", { length: 30 }).notNull(),
  reason:    text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Hired for an account the first time it links WhatsApp. */
export const DEFAULT_EMPLOYEES = [
  {
    name: "هال", role: "sales", kind: "customer", title: "موظف المبيعات", avatar: "🤝",
    persona: "ودود وواثق ومباشر. يسأل ليفهم قبل أن يعرض، ويربط الخدمة بحاجة العميل هو، ولا يضغط.",
    specialties: ["interested", "question", "greeting", "unclear"], priority: 100,
    handoffTo: "support",
  },
  {
    name: "سام", role: "support", kind: "customer", title: "موظف خدمة العملاء", avatar: "🎧",
    persona: "هادئ ومتعاطف. يستمع للشكوى كاملةً قبل أن يرد، يعتذر بصدق دون مبالغة، ولا يبرّر — يحوّل إلى مختص بشري بسرعة.",
    specialties: ["complaint"], priority: 10,
    handoffTo: null,
  },
  { name: "مارك", role: "monitor", kind: "internal", title: "موظف المراقبة", avatar: "🛡️",
    persona: null, specialties: [], priority: 999, handoffTo: null },
] as const;
