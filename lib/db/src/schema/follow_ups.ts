import { pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Where a lead came from ────────────────────────────────────────
// A click-to-WhatsApp ad stamps the first incoming message with referral data
// (contextInfo.externalAdReply + entryPointConversionSource), so an ad lead
// identifies itself and needs no manual tagging. Everything else defaults to
// "organic". Recorded once, on first contact.
export const leadSourcesTable = pgTable("lead_sources", {
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phone:       varchar("phone", { length: 50 }).notNull(),
  source:      varchar("source", { length: 20 }).notNull().default("organic"), // ad | organic
  adSourceId:  text("ad_source_id"),    // the ad's id, when WhatsApp gives one
  adSourceUrl: text("ad_source_url"),
  adTitle:     text("ad_title"),
  ctwaClid:    text("ctwa_clid"),       // click-to-WhatsApp click id
  entryPoint:  text("entry_point"),     // entryPointConversionSource, e.g. ctwa_ad
  // The raw referral payload, kept so a lead that was not recognised as an ad
  // can still be inspected afterwards — useful before the first ad runs.
  rawReferral: jsonb("raw_referral"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.phone] }),
  index("idx_lead_sources_source").on(t.userId, t.source),
]);

// ── A follow-up plan ──────────────────────────────────────────────
// steps: [{ offsetMinutes, message }], offsets measured from first contact.
export const followUpSequencesTable = pgTable("follow_up_sequences", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:         varchar("name", { length: 255 }).notNull(),
  isActive:     boolean("is_active").notNull().default(false),
  // Which leads it enrols: "ad" for ad traffic only, "all" to include organic.
  sourceFilter: varchar("source_filter", { length: 20 }).notNull().default("ad"),
  steps:        jsonb("steps").notNull(),
  // Someone who answers should stop receiving the rest of the sequence. This
  // is what separates a follow-up from a drip of unwanted messages.
  stopOnReply:  boolean("stop_on_reply").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── One scheduled message ─────────────────────────────────────────
export const followUpJobsTable = pgTable("follow_up_jobs", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => followUpSequencesTable.id, { onDelete: "cascade" }),
  phone:      varchar("phone", { length: 50 }).notNull(),
  stepIndex:  integer("step_index").notNull(),
  dueAt:      timestamp("due_at", { withTimezone: true }).notNull(),
  // pending | sent | cancelled | failed | skipped
  status:     varchar("status", { length: 20 }).notNull().default("pending"),
  sentAt:     timestamp("sent_at", { withTimezone: true }),
  error:      text("error"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Enrolment runs on every inbound message, so it must be idempotent.
  uniqueIndex("idx_follow_up_jobs_unique").on(t.sequenceId, t.phone, t.stepIndex),
  index("idx_follow_up_jobs_due").on(t.status, t.dueAt),
]);

export type LeadSource       = typeof leadSourcesTable.$inferSelect;
export type FollowUpSequence = typeof followUpSequencesTable.$inferSelect;
export type FollowUpJob      = typeof followUpJobsTable.$inferSelect;

export interface FollowUpStep { offsetMinutes: number; message: string }

/** The cadence asked for: 1h, 6h, 12h, 1d, 3d, 1w, 1mo — offsets in minutes. */
export const DEFAULT_FOLLOW_UP_OFFSETS = [60, 360, 720, 1_440, 4_320, 10_080, 43_200] as const;
